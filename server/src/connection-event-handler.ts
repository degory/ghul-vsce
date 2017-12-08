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
} from 'vscode-languageserver';

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

        connection.onCompletionResolve(
            (item: CompletionItem): CompletionItem =>
                this.onCompletionResolve(item));

        connection.onHover(
            (params: TextDocumentPositionParams): Promise<Hover> =>
                this.onHover(params));

        connection.onDefinition(
            (params: TextDocumentPositionParams): Promise<Definition> =>
                this.onDefinition(params));

        connection.onSignatureHelp(
            (params: TextDocumentPositionParams): Promise<SignatureHelp> =>
                this.onSignatureHelp(params));
    }

    onInitialize(params: any): InitializeResult {
        console.log("initialize...");

        let workspace: string = params.rootPath;

        console.log("workspace: " + workspace);

        let config = getGhulConfig(workspace);

        console.log("config: " + JSON.stringify(config));

        this.config_event_emitter.configAvailable(workspace, config);
        
        return {
            capabilities: {
                // Tell the client that the server works in FULL text document sync mode
                textDocumentSync: this.documents.syncKind,

                // Tell the client that the server support code complete
                completionProvider: {
                    triggerCharacters: ['.'],                    
                    resolveProvider: false,
                },

                hoverProvider: true,
                definitionProvider: true,
                signatureHelpProvider: {
                    triggerCharacters: ["(", "["]
                }
            }
        }
    }

    onShutdown() {
	    console.log("on shutdown: removing container");
	    this.server_manager.kill();
    }

    onExit() {
	    console.log("on exit");
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
        console.log('We recevied an file change event');
    }

    onCompletion(textDocumentPosition: CompletionParams): Promise<CompletionItem[]> {
        console.log(">>>>>> COMPLETE: received completion request: " + JSON.stringify(textDocumentPosition));

        if (textDocumentPosition.context.triggerCharacter == '.') {
            this.edit_queue.trySendQueued();
        }

        // The pass parameter contains the position of the text document in 
        // which code complete got requested. For the example we ignore this
        // info and always provide the same completion items.
        return this.requester.sendCompletion(textDocumentPosition.textDocument.uri, textDocumentPosition.position.line, textDocumentPosition.position.character);
    }

    // This handler resolve additional information for the item selected in
    // the completion list.
    onCompletionResolve(item: CompletionItem): CompletionItem {
        console.log(">>>>>> COMPLETE: received completion resolve request: " + JSON.stringify(item));

        return null;
    }

    onHover(params: TextDocumentPositionParams): Promise<Hover> {
        console.log("received hover request: " + params.textDocument.uri + "," + params.position.line + "," + params.position.character);

        return this.requester.sendHover(params.textDocument.uri, params.position.line, params.position.character);
    }

    onDefinition(params: TextDocumentPositionParams): Promise<Definition> {
        console.log("received hover request: " + params.textDocument.uri + "," + params.position.line + "," + params.position.character);

        return this.requester.sendDefinition(params.textDocument.uri, params.position.line, params.position.character);
    }
    
    onSignatureHelp(params: TextDocumentPositionParams): Promise<SignatureHelp> {
        console.log("received signature help request: " + params.textDocument.uri + "," + params.position.line + "," + params.position.character);

        this.edit_queue.trySendQueued();
        
        return this.requester.sendSignature(params.textDocument.uri, params.position.line, params.position.character);        
    }
}
