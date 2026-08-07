import * as path from 'path';

import { pathToFileURL } from 'url';

import { readdirSync } from 'fs';

import {
    Connection,
    Disposable,
    DidChangeWatchedFilesNotification,
    TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { log } from './log';

import { ConfigEventEmitter } from './config-event-emitter';
import { ServerEventEmitter } from './server-event-emitter';
import { ResponseHandler } from './response-handler';
import { Requester } from './requester';
import { EditQueue } from './edit-queue';
import { ResponseParser } from './response-parser';
import { ServerManager } from './server-manager';
import { DocumentChangeTracker } from './document-change-tracker';
import { GhulAnalyser } from './ghul-analyser';
import { Watchdog } from './watchdog';
import { Activity, ActivityProgress, SLOW_ACTIVITY_DELAY_MS } from './activity-progress';
import { MetricsReporter } from './metrics-reporter';

import { EditorSettings, getGhulConfig, GhulConfig } from './ghul-config';
import { restoreDotNetTools } from './restore-dotnet-tools';
import { generateAssembliesJson, buildReferencedAssemblies } from './generate-assemblies-json';

// How long to wait for the client to answer for its settings before falling
// back to the project's own configuration. Setup cannot proceed without an
// answer, so an unbounded wait is a workspace that never gets a compiler.
const CONFIGURATION_TIMEOUT_MS = 5_000;

// A setting the user has expressed no preference on comes back as null, and a
// client that does not know the setting at all comes back with undefined — both
// mean "unset". Anything that is not a boolean is treated the same way rather
// than coerced, so a mistyped setting falls back rather than silently reading
// as true.
function asOptionalBoolean(value: unknown): boolean | null {
    return typeof value == 'boolean' ? value : null;
}

// Bounds only the status bar, not correctness: whenAnalysed already holds
// queries safely no matter how long the first compile takes. This only stops
// the progress notification from spinning forever if the compiler never
// spawns or never completes a first compile at all.
const FIRST_COMPILE_PROGRESS_TIMEOUT_MS = 300_000;

// All compiler-facing state for a single workspace folder: one compiler child,
// its watchdog, its edit queue and the response handler that fans replies back
// out to LSP. Multiple instances can coexist in the same extension host so the
// server can later host one .ghulproj per workspace folder; ExtensionState owns
// the registry and routes per-URI requests to the right context.
export class WorkspaceContext {
    workspace_root: string;
    config: GhulConfig;

    server_event_emitter: ServerEventEmitter;
    config_event_emitter: ConfigEventEmitter;

    response_handler: ResponseHandler;
    requester: Requester;
    edit_queue: EditQueue;
    response_parser: ResponseParser;
    server_manager: ServerManager;
    document_change_tracker: DocumentChangeTracker;
    ghul_analyser: GhulAnalyser;
    watchdog: Watchdog;
    progress: ActivityProgress;
    metrics: MetricsReporter;

    private connection: Connection;
    private documents: TextDocuments<TextDocument>;

    // Set by ExtensionState from the client's declared capabilities. See the
    // note there: a client that has not declared this never answers the
    // request, so asking one that has not would stall setup outright.
    client_supports_configuration: boolean = false;

    private reference_build_attempted: boolean = false;

    private missing_assembly_watch: Promise<Disposable> | null = null;

    // Counts compiler starts, so the wait for one compiler's first compile
    // cannot close the progress belonging to the compiler that replaced it.
    private compiler_generation: number = 0;

    // Whether a compiler start is currently being reported. A compiler that
    // was never resolved never starts, and must not have its later lifecycle
    // events reopen a notification nothing will close.
    private reporting_compiler_startup: boolean = false;

    constructor(
        workspace_root: string,
        connection: Connection,
        documents: TextDocuments<TextDocument>
    ) {
        this.workspace_root = workspace_root;
        this.connection = connection;
        this.documents = documents;

        this.server_event_emitter = new ServerEventEmitter();
        this.config_event_emitter = new ConfigEventEmitter();

        this.progress = new ActivityProgress(connection);
        this.metrics = new MetricsReporter(connection, workspace_root);

        this.response_handler = new ResponseHandler(connection, this.config_event_emitter);

        // Created before the requester/edit_queue so they can be handed a live
        // watchdog reference; the on_timeout callback closes over `this` and
        // forwards to the server manager once it's constructed below.
        this.watchdog = new Watchdog(
            10000,
            () => this.server_manager.recoverFromHang(),
            busy => this.reportOutstandingRequest(busy)
        );

        this.requester = new Requester(this.server_event_emitter, this.response_handler, this.watchdog);

        this.edit_queue = new EditQueue(
            this.requester,
            this.response_handler,
            this.watchdog,
            this.progress,
            this.metrics
        );

        this.ghul_analyser = new GhulAnalyser(
            this.edit_queue,
            this.config_event_emitter,
            this.server_event_emitter,
            documents
        );

        this.response_parser = new ResponseParser(this.response_handler, this.watchdog);

        this.server_manager = new ServerManager(
            this.config_event_emitter,
            this.server_event_emitter,
            this.edit_queue,
            this.response_handler,
            this.response_parser,
            this.watchdog,
            workspace_root,
            connection
        );

        this.response_handler.setServerManager(this.server_manager);
        this.response_handler.setEditQueue(this.edit_queue);

        this.reportCompilerStartup();
    }

    // A request has gone to the compiler and no answer has come back yet.
    //
    // Worth saying something about because the analyser recompiles on demand
    // to answer a query it has no current state for, and nothing in the
    // protocol says in advance that it is about to — so an ordinary hover can
    // become a multi-second wait that otherwise looks like the editor
    // ignoring the user. Delayed, because most requests answer far too
    // quickly to be worth a spinner, and marked as a fallback so a request
    // that belongs to something already being reported (a full compile, the
    // heap check) keeps that more specific description.
    private reportOutstandingRequest(busy: boolean) {
        if (busy) {
            this.progress.report(Activity.Request, "analysing", {
                delay_ms: SLOW_ACTIVITY_DELAY_MS,
                fallback: true,
                done_message: "analysed"
            });
        } else {
            this.progress.end(Activity.Request);
        }
    }

    // The compiler is not only started once. It is recycled when it has
    // accumulated too much memory, and relaunched when it crashes or the
    // watchdog finds it wedged — and each time it comes back with no project
    // state, so the user is back to waiting through a cold analysis with the
    // editor answering nothing. Reporting off the compiler's own lifecycle
    // events rather than from initialize() means that wait is shown every
    // time it happens, not only on the first one.
    //
    // The setup steps initialize() reports before this — the tool restore, the
    // reference resolution — are not repeated on a relaunch, so a relaunch
    // shows the part of the sequence that is actually running.
    private reportCompilerStartup() {
        this.server_event_emitter.onStarting(() => {
            // A compiler that was never resolved, or one deliberately blocked,
            // is not coming: the spawn is abandoned immediately after this
            // event and nothing would ever close the progress.
            if (!this.config?.compiler?.length || this.config.block) {
                return;
            }

            this.reporting_compiler_startup = true;

            this.progress.report(Activity.Compiler, "starting compiler");

            this.awaitFirstAnalysis(++this.compiler_generation);
        });

        this.server_event_emitter.onListening(() => {
            if (this.reporting_compiler_startup) {
                this.progress.report(Activity.Compiler, "analysing project", { done_message: "project analysed" });
            }
        });
    }

    // Hold the compiler's progress open until it has analysed the project
    // once — the point at which the editor starts answering — rather than
    // ending it when the process spawns, which is the part the user cannot
    // see and does not care about.
    //
    // Bounded so a compiler that never completes a compile cannot leave the
    // status bar spinning forever. This bound is deliberately much longer than
    // whenAnalysed's own per-query ANALYSED_WAIT_TIMEOUT_MS (requester.ts):
    // giving up on an individual query early is the safe choice (the client
    // just asks again later), but ending the status bar early would say
    // "ready" while the analyser is still on its first compile, which is worse
    // than leaving it open a while longer.
    private awaitFirstAnalysis(generation: number) {
        const timeout = new Promise<void>(resolve => {
            setTimeout(resolve, FIRST_COMPILE_PROGRESS_TIMEOUT_MS).unref?.();
        });

        Promise.race([this.requester.untilFirstAnalysed(), timeout])
            .then(() => {
                // A later compiler has started since; its own wait owns the
                // progress now.
                if (this.compiler_generation != generation) {
                    return;
                }

                this.reporting_compiler_startup = false;

                this.progress.end(Activity.Compiler);
            })
            .catch(e => log(`could not finish reporting progress: ${e}`));
    }

    // Run the per-workspace setup that depends on the on-disk project layout:
    // restore the local tool manifest, regenerate .assemblies.json, parse
    // ghul.json/.ghulproj. Fires configAvailable, which is what wakes the
    // server manager and starts the compiler child.
    //
    // Runs off the initialize response, not inside it. The tool restore alone
    // can take tens of seconds on a machine that has never seen the compiler,
    // and until the response is sent the client holds back every notification
    // it has for us — so a caller that waits for this leaves the editor with
    // no language support at all and no way to say why.
    async initialize(): Promise<void> {
        let problems: string[] = [];

        // generateAssembliesJson writes .assemblies.json; getGhulConfig
        // reads it to build the -a flags for .analysis.rsp. Must run in
        // this order — on a fresh checkout the file does not yet exist,
        // so a reversed order leaves the analyser with no -a flags and
        // it falls back to a five-assembly default.
        this.progress.report(Activity.Setup, "restoring .NET tools");

        let tools_problem = await restoreDotNetTools(this.workspace_root);
        if (tools_problem) {
            problems.push(tools_problem);
        }

        this.progress.report(Activity.Setup, "resolving project references", { done_message: "project references resolved" });

        let assemblies_problem = await generateAssembliesJson(this.workspace_root);
        if (assemblies_problem) {
            problems.push(assemblies_problem);
        }

        this.config = getGhulConfig(this.workspace_root, await this.readEditorSettings());
        problems.push(...(this.config.problems ?? []));

        // Missing referenced assemblies are expected right up until the build
        // that produces them has run, and they resolve themselves without the
        // user doing anything — so stay quiet and withhold the diagnostics
        // they would distort. Once that build has been and gone they are a
        // real problem the user has to act on, so say so and let the
        // diagnostics through, incomplete as they are.
        const awaiting_reference_build =
            this.config.missing_assemblies.length > 0 && !this.reference_build_attempted;

        this.response_handler.suppress_diagnostics = awaiting_reference_build;

        if (this.config.missing_assemblies.length && !awaiting_reference_build) {
            problems.push(
                `could not build ${this.config.missing_assemblies.length} referenced ` +
                `assembly/assemblies; analysis will be incomplete until they are built`
            );
        }

        // A degraded-but-runnable load: warn so the user knows analysis may be
        // incomplete. A load with no usable compiler is fatal and reported as
        // an error by the server manager when it declines to spawn.
        if (problems.length && this.config.compiler?.length) {
            this.connection.window?.showWarningMessage(
                "ghūl language extension: " + problems.join("; ")
            );
        }

        const workspace_root_munged = this.workspace_root.replace(/\\/g, '/');

        this.document_change_tracker = new DocumentChangeTracker(
            this,
            this.edit_queue,
            this.config.source.map(glob => `${workspace_root_munged}/${glob}`),
            this.documents,
            this.config.missing_assemblies
        );

        this.watchMissingAssemblies();

        // Starts the compiler, which reports its own progress from here on
        // (see reportCompilerStartup) — so the setup activity ends into the
        // compiler's rather than into a gap.
        this.config_event_emitter.configAvailable(this.workspace_root, this.config);

        this.progress.end(Activity.Setup);

        this.buildMissingAssemblies();
    }

    // The editor's settings for this folder, with its User / Workspace /
    // Workspace Folder layers already resolved — the client does the layering,
    // which is the whole reason for asking it rather than reading a file.
    //
    // scopeUri is what makes a per-folder override work: without it a
    // multi-root workspace would get one answer for every folder.
    //
    // Never a reason for setup to fail. A client that does not support the
    // request, or answers it badly, leaves every setting unexpressed and the
    // project's own ghul.json decides.
    private async readEditorSettings(): Promise<EditorSettings> {
        if (!this.client_supports_configuration || !this.connection?.workspace?.getConfiguration) {
            return {};
        }

        const scopeUri = pathToFileURL(this.workspace_root).toString();

        try {
            // Bounded even though the capability was declared: setup must not
            // be able to stop here, and a client that declares the capability
            // and then does not answer would otherwise leave the workspace
            // with no compiler at all and nothing said about why.
            const answered = await Promise.race([
                this.connection.workspace.getConfiguration([
                    { scopeUri, section: 'ghul.incrementalAnalysis' },
                    { scopeUri, section: 'ghul.plaintextHover' },
                ]),
                new Promise<null>(resolve => {
                    setTimeout(() => resolve(null), CONFIGURATION_TIMEOUT_MS).unref?.();
                }),
            ]);

            if (!answered) {
                log("the client did not answer for its settings; using the project's own configuration");

                return {};
            }

            const [incremental_analysis, want_plaintext_hover] = answered;

            return {
                incremental_analysis: asOptionalBoolean(incremental_analysis),
                want_plaintext_hover: asOptionalBoolean(want_plaintext_hover),
            };
        } catch (e) {
            log(`could not read editor settings: ${e}`);

            return {};
        }
    }

    reinitialize() {
        // An external change — a project file, the tool manifest — can add or
        // remove references, so whatever was concluded about the previous
        // reference set no longer binds.
        this.reference_build_attempted = false;

        this.initializeDetached();
    }

    // initialize() for callers that cannot wait for it and have nowhere to put
    // a failure. Setup already collects its own problems and surfaces them to
    // the user; anything reaching here is unforeseen, and must not surface as
    // an unhandled rejection that takes the server down with it.
    initializeDetached() {
        this.initialize().catch(e => log(`workspace initialization failed: ${e}`));
    }

    // Referenced projects are not built while resolving their output paths, so
    // on a tree that has never been built those outputs are absent and the
    // analyser starts without them. Build them now, off the critical path, and
    // re-read the configuration once they exist.
    //
    // Attempted at most once per reference set: a build that fails, or that
    // leaves an output still missing, must not re-trigger itself.
    private buildMissingAssemblies() {
        if (!this.config.missing_assemblies.length || this.reference_build_attempted) {
            return;
        }

        this.reference_build_attempted = true;

        this.progress.report(Activity.References, "building referenced projects", { done_message: "referenced projects built" });

        buildReferencedAssemblies(this.workspace_root)
            .then(() => {
                this.progress.end(Activity.References);

                this.initializeDetached();
            });
    }

    // Backstop for the assemblies arriving by some other route than the build
    // above — the user building from a terminal, a sibling tool, a git
    // operation that restores them. Watches exactly the paths that are absent,
    // so once they are all present nothing is registered and an ordinary
    // rebuild during editing cannot trigger anything.
    private watchMissingAssemblies() {
        this.missing_assembly_watch?.then(watch => watch.dispose());
        this.missing_assembly_watch = null;

        if (!this.config.missing_assemblies.length || !this.connection?.client?.register) {
            return;
        }

        this.missing_assembly_watch = this.connection.client.register(
            DidChangeWatchedFilesNotification.type,
            {
                watchers: this.config.missing_assemblies.map(
                    globPattern => ({ globPattern: globPattern.replace(/\\/g, '/') })
                ),
            }
        );
    }

    // The set of file globs (already absolutised under workspace_root) that
    // belong to this workspace's project. Used by routing in ExtensionState to
    // decide which workspace owns a watched-file change.
    sourceGlobs(): string[] {
        return this.document_change_tracker?.globs ?? [];
    }

    // Absolute path to this workspace's .analysis.rsp file; per-workspace so
    // multiple compilers cannot stomp on each other when they share an
    // extension host.
    analysisResponseFilePath(): string {
        return path.join(this.workspace_root, '.analysis.rsp');
    }

    // True when the folder contains at least one .ghulproj or a ghul.json.
    // Multi-root setups commonly mix ghūl folders with unrelated ones (docs,
    // sibling JS projects, …); we only spin up a compiler for the folders
    // that actually have a ghūl project, otherwise every non-ghūl folder
    // would surface a "no usable ghūl compiler found" error.
    //
    // Uses readdirSync rather than glob so paths containing glob
    // metacharacters (`[`, `]`, `{`, `}`, `?`) — e.g. `my-project[v2]` —
    // still match correctly.
    static looksLikeGhulWorkspace(workspace_root: string): boolean {
        if (!workspace_root) {
            return false;
        }

        let entries: string[];
        try {
            entries = readdirSync(workspace_root);
        } catch {
            return false;
        }

        return entries.some(e => e.endsWith('.ghulproj') || e === 'ghul.json');
    }
}
