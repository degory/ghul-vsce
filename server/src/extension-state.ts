import {
    Connection,
    TextDocuments,
    DidChangeWatchedFilesParams
} from 'vscode-languageserver';

import {
    createConnection
} from 'vscode-languageserver/node'

import { TextDocument } from 'vscode-languageserver-textdocument';

import { URI } from 'vscode-uri';

import { ConnectionEventHandler } from './connection-event-handler';

import { WorkspaceContext } from './workspace-context';

import { log } from './log';

// Top-level host. Owns the single LSP Connection and the shared TextDocuments
// registry, plus a registry of WorkspaceContext instances. Per-workspace state
// (the compiler child, edit queue, watchdog, response handler) lives on the
// individual WorkspaceContext; this class only routes between them.
//
// Today there is exactly one workspace folder, registered by
// ConnectionEventHandler.onInitialize from params.rootPath. Multi-workspace
// support is wired from this side by reading params.workspaceFolders and
// registering one context per entry, then doing the same for
// workspace/didChangeWorkspaceFolders.
export class ExtensionState {
    private static instance: ExtensionState;

    public connection: Connection;

    public documents: TextDocuments<TextDocument>;

    public connection_event_handler: ConnectionEventHandler;

    // Keyed by workspace_root path. Insertion order matters: the first
    // registered workspace is the default for requests whose URI doesn't
    // belong to any folder.
    private workspaces: Map<string, WorkspaceContext> = new Map();

    private constructor() {
    }

    public static getInstance(): ExtensionState {
        if (!ExtensionState.instance) {
            ExtensionState.instance = new ExtensionState();
        }

        return ExtensionState.instance;
    }

    // Visible-for-tests reset. Drops registered workspaces so each test starts
    // from a clean slate; production code never calls this.
    public reset() {
        this.workspaces.clear();
    }

    public connect() {
        this.connection = createConnection();
        this.documents = new TextDocuments(TextDocument);

        // Per-URI demux: route the change to the workspace that owns the file.
        // If no workspace owns it, drop the change — the file is outside every
        // registered .ghulproj source set.
        this.documents.onDidChangeContent((change) => {
            const workspace = this.getWorkspaceForUri(change.document.uri);

            workspace?.edit_queue.queueEdit(change);
        });

        // Open-set membership changes only on open/close, not on every
        // keystroke — so track those events rather than content changes.
        this.documents.onDidOpen(() => this.broadcastOpenFiles());
        this.documents.onDidClose(() => this.broadcastOpenFiles());

        this.connection_event_handler = new ConnectionEventHandler(
            this,
            this.connection,
            this.documents
        );

        this.documents.listen(this.connection);
        this.connection.listen();
    }

    // Create a WorkspaceContext for the given root and store it in the
    // registry. Caller is responsible for invoking context.initialize();
    // ConnectionEventHandler.onInitialize does it straight away today.
    public registerWorkspace(workspace_root: string): WorkspaceContext {
        const existing = this.workspaces.get(workspace_root);

        if (existing) {
            return existing;
        }

        const context = new WorkspaceContext(workspace_root, this.connection, this.documents);

        this.workspaces.set(workspace_root, context);

        return context;
    }

    public unregisterWorkspace(workspace_root: string) {
        const context = this.workspaces.get(workspace_root);

        if (!context) {
            return;
        }

        context.server_manager?.kill();
        this.workspaces.delete(workspace_root);
    }

    public allWorkspaces(): WorkspaceContext[] {
        return Array.from(this.workspaces.values());
    }

    // Recompute each workspace's open-file set from the currently-open
    // documents and push it to that workspace's analyser. Every workspace is
    // told — even to an empty set — so a workspace whose last open file just
    // closed clears its scope. Per-URI demux mirrors onDidChangeContent.
    private broadcastOpenFiles() {
        const uris_by_workspace = new Map<WorkspaceContext, string[]>();

        for (const document of this.documents.all()) {
            const workspace = this.getWorkspaceForUri(document.uri);

            if (!workspace) {
                continue;
            }

            const uris = uris_by_workspace.get(workspace) ?? [];
            uris.push(document.uri);
            uris_by_workspace.set(workspace, uris);
        }

        for (const workspace of this.allWorkspaces()) {
            workspace.edit_queue.sendOpenFiles(uris_by_workspace.get(workspace) ?? []);
        }
    }

    // For requests that aren't tied to a specific URI (workspace/symbol,
    // background heap checks). Returns the first registered workspace today;
    // multi-workspace will need callers that aggregate across all workspaces.
    public defaultWorkspace(): WorkspaceContext | null {
        const iter = this.workspaces.values().next();

        return iter.done ? null : iter.value;
    }

    // Find the workspace that owns this document URI by longest matching
    // workspace_root prefix on the parsed fsPath. Returns null if no
    // workspace claims the file — caller should drop the request rather
    // than route arbitrarily.
    public getWorkspaceForUri(uri: string): WorkspaceContext | null {
        let fs_path: string;

        try {
            fs_path = URI.parse(uri).fsPath;
        } catch (e) {
            log(`getWorkspaceForUri: could not parse uri '${uri}': ${e}`);
            return null;
        }

        if (!fs_path) {
            return null;
        }

        const fs_path_normalised = fs_path.replace(/\\/g, '/');

        let best: WorkspaceContext | null = null;
        let best_length = -1;

        for (const context of this.workspaces.values()) {
            const root_normalised = context.workspace_root.replace(/\\/g, '/');

            if (
                fs_path_normalised === root_normalised ||
                fs_path_normalised.startsWith(root_normalised + '/')
            ) {
                if (root_normalised.length > best_length) {
                    best = context;
                    best_length = root_normalised.length;
                }
            }
        }

        return best;
    }

    // Single demux for watched-file events: the LSP Connection only allows one
    // handler, so we register it here and fan each change out to the workspace
    // that owns it.
    public onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        if (!params?.changes) {
            return;
        }

        for (const change of params.changes) {
            const workspace = this.getWorkspaceForUri(change.uri);

            if (!workspace) {
                continue;
            }

            workspace.document_change_tracker?.onDidChangeWatchedFiles({
                changes: [change]
            });
        }
    }
}
