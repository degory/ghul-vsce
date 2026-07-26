import * as path from 'path';

import { readdirSync } from 'fs';

import { Connection, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

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
    initialize() {
        let problems: string[] = [];

        // generateAssembliesJson writes .assemblies.json; getGhulConfig
        // reads it to build the -a flags for .analysis.rsp. Must run in
        // this order — on a fresh checkout the file does not yet exist,
        // so a reversed order leaves the analyser with no -a flags and
        // it falls back to a five-assembly default.
        let tools_problem = restoreDotNetTools(this.workspace_root);
        if (tools_problem) {
            problems.push(tools_problem);
        }

        let assemblies_problem = generateAssembliesJson(this.workspace_root);
        if (assemblies_problem) {
            problems.push(assemblies_problem);
        }

        this.config = getGhulConfig(this.workspace_root);
        problems.push(...(this.config.problems ?? []));

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
            this.documents
        );

        this.config_event_emitter.configAvailable(this.workspace_root, this.config);

        this.buildMissingAssemblies();
    }

    reinitialize() {
        // An external change — a project file, the tool manifest — can add or
        // remove references, so whatever was concluded about the previous
        // reference set no longer binds.
        this.reference_build_attempted = false;

        this.initialize();
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
            .then(() => this.initialize());
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
