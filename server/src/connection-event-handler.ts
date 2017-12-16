import {
    DidChangeConfigurationParams,
    DidChangeWatchedFilesParams,
    Definition,
    CompletionItem,
    Hover,
    // HoverRequest,
    IConnection,
    InitializeResult,
    InitializedParams,
    TextDocuments,
    TextDocumentPositionParams,
    SignatureHelp,
    CompletionParams,
    DocumentSymbolParams,
    SymbolInformation
} from 'vscode-languageserver';

import { log } from './server';

import { getGhulConfig } from './ghul-config';

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerManager } from './server-manager';

import { Requester } from './requester';

import { EditQueue } from './edit-queue';

export class ConnectionEventHandler {
    connection: IConnection; 
    server_manager: ServerManager;
    documents: TextDocuments;
    config_event_emitter: ConfigEventEmitter;
    requester: Requester;
    edit_queue: EditQueue;
    
    constructor(
        connection: IConnection,
        server_manager: ServerManager,
        documents: TextDocuments,
        config_event_emitter: ConfigEventEmitter,        
        requester: Requester,
        edit_queue: EditQueue
    ) {
        this.connection = connection;
        this.server_manager = server_manager;
        this.documents = documents;
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

        connection.onDidChangeWatchedFiles((change: DidChangeWatchedFilesParams) =>
            this.onDidChangeWatchedFiles(change));

        connection.onCompletion(
            (textDocumentPosition: CompletionParams): Promise<CompletionItem[]> =>
                this.onCompletion(textDocumentPosition));

        connection.onHover(
            (params: TextDocumentPositionParams): Promise<Hover> =>
                this.onHover(params));

        connection.onDefinition(
            (params: TextDocumentPositionParams): Promise<Definition> =>
                this.onDefinition(params));

        connection.onSignatureHelp(
            (params: TextDocumentPositionParams): Promise<SignatureHelp> =>
                this.onSignatureHelp(params));

        connection.onDocumentSymbol(
            (params: DocumentSymbolParams): Promise<SymbolInformation[]> =>
                this.onDocumentSymbol(params));

        connection.onWorkspaceSymbol(
            (): Promise<SymbolInformation[]> =>
                this.onWorkspaceSymbol());                        
    }

    onInitialize(params: any): InitializeResult {
        log("initialize...");

        let workspace: string = params.rootPath;

        log("workspace: " + workspace);

        let config = getGhulConfig(workspace);

        log("config: " + JSON.stringify(config));

        this.config_event_emitter.configAvailable(workspace, config);

        log("starting up with documentSymbolProvider: true...");
        
        return {
            capabilities: {
                // Tell the client that the server works in FULL text document sync mode
                textDocumentSync: this.documents.syncKind,

                // Tell the client that the server support code complete
                completionProvider: {
                    triggerCharacters: ['.'],                    
                    resolveProvider: false,
                },
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                hoverProvider: true,
                definitionProvider: true,
                signatureHelpProvider: {
                    triggerCharacters: ["(", "["]
                }
            }
        }
    }

    onShutdown() {
	    log("on shutdown: removing container");
	    this.server_manager.kill();
    }

    onExit() {
	    log("on exit");
    }

    onDidChangeConfiguration(_change: DidChangeConfigurationParams) {
        /*
        let settings = <Settings>change.settings;
        maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
        // Revalidate any open text documents

        documents.all().forEach((d: TextDocument) => validateSingleDocument(d.uri, d.getText()));	

        analyse();
        */
    }
    
    onDidChangeWatchedFiles(_change: DidChangeWatchedFilesParams) {
        // Monitored files have change in VSCode
        log('We recevied an file change event');
    }

    onCompletion(textDocumentPosition: CompletionParams): Promise<CompletionItem[]> {
        log("UI requests completion");
        if (textDocumentPosition.context.triggerCharacter == '.') {
            this.edit_queue.trySendQueued();
        }
        log("after try send queued");

        return this.requester.sendCompletion(textDocumentPosition.textDocument.uri, textDocumentPosition.position.line, textDocumentPosition.position.character);
    }

    onHover(params: TextDocumentPositionParams): Promise<Hover> {
        return this.requester.sendHover(params.textDocument.uri, params.position.line, params.position.character);
    }

    onDefinition(params: TextDocumentPositionParams): Promise<Definition> {
        return this.requester.sendDefinition(params.textDocument.uri, params.position.line, params.position.character);
    }
    
    onSignatureHelp(params: TextDocumentPositionParams): Promise<SignatureHelp> {
        this.edit_queue.trySendQueued();
        
        return this.requester.sendSignature(params.textDocument.uri, params.position.line, params.position.character);        
    }

    onDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]> {
        log("############## onDocumentSymbol: " + JSON.stringify(params));

        return this.requester.sendDocumentSymbol(params.textDocument.uri);
    }

    onWorkspaceSymbol(): Promise<SymbolInformation[]> {
        log("############## onWorkspaceSymbol");

        return this.requester.sendWorkspaceSymbol();
    }
}
