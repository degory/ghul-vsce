import * as path from 'path';

import { readdirSync } from 'fs';

import {
    Connection,
    Disposable,
    DidChangeWatchedFilesNotification,
    TextDocuments,
    WorkDoneProgressServerReporter
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

import { getGhulConfig, GhulConfig } from './ghul-config';
import { restoreDotNetTools } from './restore-dotnet-tools';
import { generateAssembliesJson, buildReferencedAssemblies } from './generate-assemblies-json';

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

    private connection: Connection;
    private documents: TextDocuments<TextDocument>;

    private reference_build_attempted: boolean = false;

    private missing_assembly_watch: Promise<Disposable> | null = null;

    // The progress reporter finishProgress() is currently waiting to close,
    // if any. reinitialize() (e.g. once buildMissingAssemblies() finishes)
    // can start a fresh initialize() while an earlier one is still waiting
    // on its own first compile; without this, both would stay open at once.
    private active_progress: WorkDoneProgressServerReporter | null = null;

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

        this.response_handler = new ResponseHandler(connection, this.config_event_emitter);

        // Created before the requester/edit_queue so they can be handed a live
        // watchdog reference; the on_timeout callback closes over `this` and
        // forwards to the server manager once it's constructed below.
        this.watchdog = new Watchdog(10000, () => this.server_manager.recoverFromHang());

        this.requester = new Requester(this.server_event_emitter, this.response_handler, this.watchdog);

        this.edit_queue = new EditQueue(this.requester, this.response_handler, this.watchdog);

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

        // A previous initialize() may still be waiting on its own first
        // compile (see finishProgress() below) — e.g. buildMissingAssemblies()
        // re-triggers this once a referenced assembly finishes building.
        // That progress is now stale; close it rather than leaving two open
        // at once.
        this.active_progress?.done();

        const progress = await this.startProgress();
        this.active_progress = progress;

        // generateAssembliesJson writes .assemblies.json; getGhulConfig
        // reads it to build the -a flags for .analysis.rsp. Must run in
        // this order — on a fresh checkout the file does not yet exist,
        // so a reversed order leaves the analyser with no -a flags and
        // it falls back to a five-assembly default.
        progress?.report("restoring .NET tools");

        let tools_problem = await restoreDotNetTools(this.workspace_root);
        if (tools_problem) {
            problems.push(tools_problem);
        }

        progress?.report("resolving project references");

        let assemblies_problem = await generateAssembliesJson(this.workspace_root);
        if (assemblies_problem) {
            problems.push(assemblies_problem);
        }

        this.config = getGhulConfig(this.workspace_root);
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

        this.config_event_emitter.configAvailable(this.workspace_root, this.config);

        this.buildMissingAssemblies();

        // Deliberately not awaited: nothing downstream depends on when the
        // status bar finally closes, and blocking initialize() on it would
        // delay whatever a caller synchronizes on this promise for (both a
        // fresh load and a config-triggered reinitialize await it). Caught
        // the same way initializeDetached() catches initialize() itself: this
        // waits up to FIRST_COMPILE_PROGRESS_TIMEOUT_MS, long enough for the
        // connection to legitimately have gone away in the meantime, and an
        // unhandled rejection here would take the whole server down with it.
        this.finishProgress(progress).catch(e => log(`could not finish reporting progress: ${e}`));
    }

    // The setup above initialize() awaits is the smaller part of a cold
    // start; the analyser's own first compile of the project is usually the
    // greater part of it, and until now it ran with no visible progress at
    // all — the status bar disappeared the moment the compiler spawned. Keep
    // it open, with an updated message, through that first compile too.
    // Bounded so a compiler that never spawns, or never completes a compile,
    // cannot leave the status bar spinning forever. This bound is deliberately
    // much longer than whenAnalysed's own per-query ANALYSED_WAIT_TIMEOUT_MS
    // (requester.ts): giving up on an individual query early is the safe
    // choice (the client just asks again later), but ending the status bar
    // early would say "ready" while the analyser is still on its first
    // compile, which is worse than leaving it open a while longer.
    private async finishProgress(progress: WorkDoneProgressServerReporter | null): Promise<void> {
        if (this.config.compiler?.length) {
            progress?.report("waiting for the compiler to analyse the project");

            await Promise.race([
                this.requester.untilFirstAnalysed(),
                new Promise<void>(resolve => setTimeout(resolve, FIRST_COMPILE_PROGRESS_TIMEOUT_MS).unref())
            ]);
        }

        progress?.done();

        if (this.active_progress === progress) {
            this.active_progress = null;
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

    // A progress notification for the setup the user would otherwise wait
    // through with no sign anything is happening. Silently absent on a client
    // that does not support it, and never a reason for setup to fail.
    private async startProgress(): Promise<WorkDoneProgressServerReporter | null> {
        if (!this.connection?.window?.createWorkDoneProgress) {
            return null;
        }

        try {
            const progress = await this.connection.window.createWorkDoneProgress();

            progress.begin("ghūl", undefined, undefined, false);

            return progress;
        } catch (e) {
            log(`could not create a progress reporter: ${e}`);
            return null;
        }
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

        buildReferencedAssemblies(this.workspace_root)
            .then(() => this.initializeDetached());
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
