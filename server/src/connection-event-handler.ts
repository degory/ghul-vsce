
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

import { TextDocument } from 'vscode-languageserver-textdocument';

import { log } from './log';

import { getGhulConfig, GhulConfig } from './ghul-config';

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerManager } from './server-manager';

import { Requester } from './requester';

import { EditQueue } from './edit-queue';
import { generateAssembliesJson } from './generate-assemblies-json';
import { restoreDotNetTools } from './restore-dotnet-tools';
import { DocumentChangeTracker } from './document-change-tracker';

export class ConnectionEventHandler {
    connection: Connection; 
    server_manager: ServerManager;
    config_event_emitter: ConfigEventEmitter;
    requester: Requester;
    edit_queue: EditQueue;
    config: GhulConfig;
    workspace_root: string;
    document_change_tracker: DocumentChangeTracker;
    documents: TextDocuments<TextDocument>;

    constructor(
        connection: Connection,
        server_manager: ServerManager,
        config_event_emitter: ConfigEventEmitter,
        requester: Requester,
        edit_queue: EditQueue,
        documents: TextDocuments<TextDocument>
    ) {
        this.connection = connection;
        this.server_manager = server_manager;
        this.config_event_emitter = config_event_emitter;
        this.requester = requester;
        this.edit_queue = edit_queue;
        this.documents = documents;

        connection.onInitialize((params: InitializedParams): InitializeResult => 
            this.onInitialize(params));

        connection.onShutdown(() => 
            this.onShutdown());

        connection.onExit(() => 
            this.onExit());

        connection.onDidChangeConfiguration((change: DidChangeConfigurationParams) =>
            this.onDidChangeConfiguration(change));

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
    }

    initialize() {
        // generateAssembliesJson writes .assemblies.json; getGhulConfig
        // reads it to build the -a flags for .analysis.rsp. Must run in
        // this order — on a fresh checkout the file does not yet exist,
        // so a reversed order leaves the analyser with no -a flags and
        // it falls back to a five-assembly default.
        let problems: string[] = [];

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

        // FIXME is there a better way to do this?
        const workspace_root_munged = this.workspace_root.replace(/\\/g, '/');
        
        this.document_change_tracker =
            new DocumentChangeTracker(
                this.edit_queue,
                this.config.source.map(glob => `${workspace_root_munged}/${glob}`),
                this.documents
            );

        this.config_event_emitter.configAvailable(this.workspace_root, this.config);

        this.connection.onDidChangeWatchedFiles((change: DidChangeWatchedFilesParams) =>
            this.document_change_tracker?.onDidChangeWatchedFiles(change));
    }

    onInitialize(params: any): InitializeResult {
        this.workspace_root = params.rootPath;

        this.initialize();

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
                documentRangeFormattingProvider: true
            }
        }
    }

    onShutdown() {
	    log("language extension: shutting down...");
	    this.server_manager.kill();
    }

    onExit() {
	    log("language extension: exit");
    }

    onDidChangeConfiguration(_change: DidChangeConfigurationParams) {
        log("language extension: configuration changed");

        // TODO: handle configuration change
    }

    onCompletion(textDocumentPosition: CompletionParams): Promise<CompletionItem[]> {
        if (textDocumentPosition.context.triggerCharacter == '.') {
            this.edit_queue.sendQueued();
        }

        return this.requester.sendCompletion(textDocumentPosition.textDocument.uri, textDocumentPosition.position.line, textDocumentPosition.position.character);
    }

    onHover(params: TextDocumentPositionParams): Promise<Hover> {
        return this.requester.sendHover(params.textDocument.uri, params.position.line, params.position.character);
    }

    onDefinition(params: TextDocumentPositionParams): Promise<Definition> {
        return this.requester.sendDefinition(params.textDocument.uri, params.position.line, params.position.character);
    }

    onDeclaration(params: TextDocumentPositionParams): Promise<Definition> {
        return this.requester.sendDeclaration(params.textDocument.uri, params.position.line, params.position.character);
    }
    
    onSignatureHelp(params: TextDocumentPositionParams): Promise<SignatureHelp> {
        this.edit_queue.sendQueued();
        
        return this.requester.sendSignature(params.textDocument.uri, params.position.line, params.position.character);        
    }

    onDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]> {
        return this.requester.sendDocumentSymbol(params.textDocument.uri);
    }

    onWorkspaceSymbol(): Promise<SymbolInformation[]> {
        return this.requester.sendWorkspaceSymbol();
    }
    
    onReferences(params: ReferenceParams): Promise<Location[]> {
        return this.requester.sendReferences(params.textDocument.uri, params.position.line, params.position.character);
    }

    onImplementation(params: TextDocumentPositionParams): Promise<Location[]> {
        return this.requester.sendImplementation(params.textDocument.uri, params.position.line, params.position.character);
    }

    onTypeDefinition(params: TextDocumentPositionParams): Promise<Definition> {
        return this.requester.sendTypeDefinition(params.textDocument.uri, params.position.line, params.position.character);
    }

    onRenameRequest(params: RenameParams): Promise<WorkspaceEdit> {
        return this.requester.sendRenameRequest(params.textDocument.uri, params.position.line, params.position.character, params.newName);
    }

    onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
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

        return this.requester.sendDocumentFormatting(
            params.textDocument.uri,
            document.getText(),
            whole_document
        );
    }

    onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[]> {
        let document = this.documents.get(params.textDocument.uri);

        if (!document) {
            return Promise.resolve([]);
        }

        // The analyser snaps the requested range out to whole enclosing
        // definitions/statements and replies with the exact span it formatted.
        return this.requester.sendDocumentRangeFormatting(
            params.textDocument.uri,
            document.getText(),
            params.range
        );
    }
}
