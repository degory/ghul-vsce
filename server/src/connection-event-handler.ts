
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
} from 'vscode-languageserver';

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

    constructor(
        connection: Connection,
        server_manager: ServerManager,
        config_event_emitter: ConfigEventEmitter,        
        requester: Requester,
        edit_queue: EditQueue
    ) {
        this.connection = connection;
        this.server_manager = server_manager;
        this.config_event_emitter = config_event_emitter;
        this.requester = requester;
        this.edit_queue = edit_queue;

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

        connection.onRenameRequest(
             (params: RenameParams): Promise<WorkspaceEdit> =>
                this.onRenameRequest(params));
    }

    initialize() {
        this.config = getGhulConfig(this.workspace_root);

        restoreDotNetTools(this.workspace_root)
        generateAssembliesJson(this.workspace_root);

        // FIXME is there a better way to do this?
        const workspace_root_munged = this.workspace_root.replace(/\\/g, '/');
        
        this.document_change_tracker = 
            new DocumentChangeTracker(
                this.edit_queue,
                this.config.source.map(glob => `${workspace_root_munged}/${glob}`)
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
                    triggerCharacters: ['.'],
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
                renameProvider: true
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

    onRenameRequest(params: RenameParams): Promise<WorkspaceEdit> {
        return this.requester.sendRenameRequest(params.textDocument.uri, params.position.line, params.position.character, params.newName);
    }
}
