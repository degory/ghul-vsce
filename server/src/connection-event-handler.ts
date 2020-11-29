import {
    DidChangeConfigurationParams,
    DidChangeWatchedFilesParams,
    Definition,
    CompletionItem,
    Hover,
    // HoverRequest,
    IConnection,
    InitializeResult,
    TextDocuments,
    TextDocumentPositionParams,
    SignatureHelp,
    CompletionParams,
    DocumentSymbolParams,
    SymbolInformation,
    ReferenceParams,
    Location,
    InitializeParams
} from 'vscode-languageserver';

import { log } from './server';

import { getGhulConfig } from './ghul-config';

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerManager } from './server-manager';

import { Requester } from './requester';

import { Document, EditQueue } from './edit-queue';

export class ConnectionEventHandler {
    connection: IConnection; 
    server_manager: ServerManager;
    documents: TextDocuments<Document>;
    config_event_emitter: ConfigEventEmitter;
    requester: Requester;
    edit_queue: EditQueue;
    
    constructor(
        connection: IConnection,
        server_manager: ServerManager,
        documents: TextDocuments<Document>,
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

        connection.onInitialize((params: InitializeParams): InitializeResult => 
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

        connection.onReferences(
            (params: ReferenceParams): Promise<Location[]> =>
                this.onReferences(params));        
    }

    onInitialize(params: InitializeParams): InitializeResult {

        let workspace: string = params.rootPath;

        let config = getGhulConfig(workspace);

        this.config_event_emitter.configAvailable(workspace, config);
        
        return {
            capabilities: {
                // textDocumentSync: this.documents.syncKind,
                completionProvider: {
                    triggerCharacters: ['.'],                    
                    resolveProvider: false,
                },
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                signatureHelpProvider: {
                    triggerCharacters: ["(", "["]
                },
                workspace: {
                    workspaceFolders: {
                        changeNotifications: true
                    }
                }
            }
        }
    }

    onShutdown() {
	    log("ghūl language extension: shutting down...");
	    this.server_manager.kill();
    }

    onExit() {
	    log("ghūl language extension: exit");
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
    
    onDidChangeWatchedFiles(change: DidChangeWatchedFilesParams) {
        log('file change event received:', change);

        this.requester.sendWatchedFileChanged(change);
    }

    onCompletion(textDocumentPosition: CompletionParams): Promise<CompletionItem[]> {
        if (textDocumentPosition.context.triggerCharacter == '.') {
            this.edit_queue.trySendQueued();
        }

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
        return this.requester.sendDocumentSymbol(params.textDocument.uri);
    }

    onWorkspaceSymbol(): Promise<SymbolInformation[]> {
        return this.requester.sendWorkspaceSymbol();
    }
    
    onReferences(params: ReferenceParams): Promise<Location[]> {
        return this.requester.sendReferences(params.textDocument.uri, params.position.line, params.position.character);
    }
}
