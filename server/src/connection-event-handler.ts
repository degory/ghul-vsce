
import {
    DidChangeConfigurationParams,
    DidChangeWatchedFilesParams,
    Definition,
    CompletionItem,
    Hover,
    Connection,
    InitializeResult,
    InitializedParams,
    TextDocumentPositionParams,
    SemanticTokens,
    SemanticTokensParams,
    SignatureHelp,
    CompletionParams,
    DocumentSymbolParams,
    SymbolInformation,
    ReferenceParams,
    Location,
    RenameParams,
    WorkspaceEdit,
    TextDocumentSyncKind,
    DocumentFormattingParams,
    DocumentRangeFormattingParams,
    TextEdit,
    TextDocuments,
} from 'vscode-languageserver';

import { SEMANTIC_TOKENS_LEGEND } from './response-handler';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { log } from './log';

import { ExtensionState } from './extension-state';

import { WorkspaceContext } from './workspace-context';

export class ConnectionEventHandler {
    extension_state: ExtensionState;
    connection: Connection;
    documents: TextDocuments<TextDocument>;

    constructor(
        extension_state: ExtensionState,
        connection: Connection,
        documents: TextDocuments<TextDocument>
    ) {
        this.extension_state = extension_state;
        this.connection = connection;
        this.documents = documents;

        connection.onInitialize((params: InitializedParams): InitializeResult =>
            this.onInitialize(params));

        connection.onShutdown(() =>
            this.onShutdown());

        connection.onExit(() =>
            this.onExit());

        connection.onDidChangeConfiguration((change: DidChangeConfigurationParams) =>
            this.onDidChangeConfiguration(change));

        connection.onDidChangeWatchedFiles((change: DidChangeWatchedFilesParams) =>
            this.extension_state.onDidChangeWatchedFiles(change));

        connection.onCompletion(
            (textDocumentPosition: CompletionParams): Promise<CompletionItem[]> =>
                this.onCompletion(textDocumentPosition));

        connection.onHover(
            (params: TextDocumentPositionParams): Promise<Hover> =>
                this.onHover(params));

        connection.onDefinition(
            (params: TextDocumentPositionParams): Promise<Definition> =>
                this.onDefinition(params));

        connection.onDeclaration(
            (params: TextDocumentPositionParams): Promise<Definition> =>
                this.onDeclaration(params));

        connection.onSignatureHelp(
            (params: TextDocumentPositionParams): Promise<SignatureHelp> =>
                this.onSignatureHelp(params));

        connection.onDocumentSymbol(
            (params: DocumentSymbolParams): Promise<SymbolInformation[]> =>
                this.onDocumentSymbol(params));

        connection.onWorkspaceSymbol(
            (): Promise<SymbolInformation[]> =>
                this.onWorkspaceSymbol());

        connection.onReferences(
            (params: ReferenceParams): Promise<Location[]> =>
                this.onReferences(params));

        connection.onImplementation(
            (params: TextDocumentPositionParams): Promise<Definition> =>
                this.onImplementation(params));

        connection.onTypeDefinition(
            (params: TextDocumentPositionParams): Promise<Definition> =>
                this.onTypeDefinition(params));

        connection.onRenameRequest(
             (params: RenameParams): Promise<WorkspaceEdit> =>
                this.onRenameRequest(params));

        connection.onDocumentFormatting(
            (params: DocumentFormattingParams): Promise<TextEdit[]> =>
                this.onDocumentFormatting(params));

        connection.onDocumentRangeFormatting(
            (params: DocumentRangeFormattingParams): Promise<TextEdit[]> =>
                this.onDocumentRangeFormatting(params));

        connection.languages.semanticTokens.on(
            (params: SemanticTokensParams): Promise<SemanticTokens> =>
                this.onSemanticTokens(params));
    }

    // Routes per-URI requests to the workspace that owns the file. Returns
    // null when the URI lives outside every registered workspace (or when no
    // workspace is registered yet); the per-request handlers below treat that
    // as an empty result.
    private workspaceForUri(uri: string): WorkspaceContext | null {
        return this.extension_state.getWorkspaceForUri(uri);
    }

    onInitialize(params: any): InitializeResult {
        // Single-workspace scaffolding: register the legacy rootPath as the
        // sole workspace. Multi-workspace will read params.workspaceFolders
        // instead and register one context per folder.
        const workspace_root: string = params.rootPath;

        const workspace = this.extension_state.registerWorkspace(workspace_root);

        workspace.initialize();

        return {
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                    change: TextDocumentSyncKind.Incremental
                },
                completionProvider: {
                    // `:` opens a type-position request (let / property /
                    // argument / generic constraint / class-or-trait
                    // inheritance / `(name: type, ...)` tuple element).
                    // The analyser returns no candidates for non-type
                    // `:` contexts (case-when labels, `::` range
                    // operator, tuple-literal `name: value`), so the
                    // popup stays hidden in those cases without any
                    // VSCE-side filtering.
                    triggerCharacters: ['.', ':'],
                    resolveProvider: false,
                },
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                hoverProvider: true,
                definitionProvider: true,
                declarationProvider: true,
                referencesProvider: true,
                signatureHelpProvider: {
                    triggerCharacters: ["(", "["]
                },
                implementationProvider: true,
                typeDefinitionProvider: true,
                renameProvider: true,
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                semanticTokensProvider: {
                    legend: SEMANTIC_TOKENS_LEGEND,
                    full: true,
                    range: false,
                }
            }
        }
    }

    onShutdown() {
        log("language extension: shutting down...");

        for (const workspace of this.extension_state.allWorkspaces()) {
            workspace.server_manager.kill();
        }
    }

    onExit() {
        log("language extension: exit");
    }

    onDidChangeConfiguration(_change: DidChangeConfigurationParams) {
        log("language extension: configuration changed");

        // TODO: handle configuration change
    }

    onCompletion(textDocumentPosition: CompletionParams): Promise<CompletionItem[]> {
        const workspace = this.workspaceForUri(textDocumentPosition.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        if (textDocumentPosition.context.triggerCharacter == '.') {
            workspace.edit_queue.sendQueued();
        }

        return workspace.requester.sendCompletion(
            textDocumentPosition.textDocument.uri,
            textDocumentPosition.position.line,
            textDocumentPosition.position.character
        );
    }

    onHover(params: TextDocumentPositionParams): Promise<Hover> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve(null);
        }

        return workspace.requester.sendHover(params.textDocument.uri, params.position.line, params.position.character);
    }

    onDefinition(params: TextDocumentPositionParams): Promise<Definition> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        return workspace.requester.sendDefinition(params.textDocument.uri, params.position.line, params.position.character);
    }

    onDeclaration(params: TextDocumentPositionParams): Promise<Definition> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        return workspace.requester.sendDeclaration(params.textDocument.uri, params.position.line, params.position.character);
    }

    onSignatureHelp(params: TextDocumentPositionParams): Promise<SignatureHelp> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve(null);
        }

        workspace.edit_queue.sendQueued();

        return workspace.requester.sendSignature(params.textDocument.uri, params.position.line, params.position.character);
    }

    onDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        return workspace.requester.sendDocumentSymbol(params.textDocument.uri);
    }

    // Workspace-symbol queries are not URI-scoped. For now route to the
    // default (first-registered) workspace; multi-workspace will need to fan
    // out across every workspace and merge the results.
    onWorkspaceSymbol(): Promise<SymbolInformation[]> {
        const workspace = this.extension_state.defaultWorkspace();

        if (!workspace) {
            return Promise.resolve([]);
        }

        return workspace.requester.sendWorkspaceSymbol();
    }

    onReferences(params: ReferenceParams): Promise<Location[]> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        return workspace.requester.sendReferences(params.textDocument.uri, params.position.line, params.position.character);
    }

    onImplementation(params: TextDocumentPositionParams): Promise<Location[]> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        return workspace.requester.sendImplementation(params.textDocument.uri, params.position.line, params.position.character);
    }

    onTypeDefinition(params: TextDocumentPositionParams): Promise<Definition> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        return workspace.requester.sendTypeDefinition(params.textDocument.uri, params.position.line, params.position.character);
    }

    onRenameRequest(params: RenameParams): Promise<WorkspaceEdit> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve(null);
        }

        return workspace.requester.sendRenameRequest(params.textDocument.uri, params.position.line, params.position.character, params.newName);
    }

    onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        let document = this.documents.get(params.textDocument.uri);

        if (!document) {
            return Promise.resolve([]);
        }

        // The whole document is replaced; the analyser reparses the buffer we
        // send, so flushing pending edits first is not required for correctness.
        let whole_document = {
            start: { line: 0, character: 0 },
            end: { line: document.lineCount + 1, character: 0 }
        };

        return workspace.requester.sendDocumentFormatting(
            params.textDocument.uri,
            document.getText(),
            whole_document
        );
    }

    onSemanticTokens(params: SemanticTokensParams): Promise<SemanticTokens> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve({ data: [] });
        }

        // Flush queued edits so the analyser's hover map reflects the
        // current document text before we ask for tokens.
        workspace.edit_queue.sendQueued();

        return workspace.requester.sendSemanticTokens(params.textDocument.uri);
    }

    onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[]> {
        const workspace = this.workspaceForUri(params.textDocument.uri);

        if (!workspace) {
            return Promise.resolve([]);
        }

        let document = this.documents.get(params.textDocument.uri);

        if (!document) {
            return Promise.resolve([]);
        }

        // The analyser snaps the requested range out to whole enclosing
        // definitions/statements and replies with the exact span it formatted.
        return workspace.requester.sendDocumentRangeFormatting(
            params.textDocument.uri,
            document.getText(),
            params.range
        );
    }
}
