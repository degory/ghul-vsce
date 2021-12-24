import * as minimatch from 'minimatch';

import { URI } from 'vscode-uri';

import * as path from 'path';

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
    SymbolInformation,
    ReferenceParams,
    Location,
    RenameParams,
    WorkspaceEdit,
    DidOpenTextDocumentParams
} from 'vscode-languageserver';

import { log } from './server';

import { getGhulConfig, GhulConfig } from './ghul-config';

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerManager } from './server-manager';

import { Requester } from './requester';

import { EditQueue } from './edit-queue';
import { generateAssembliesJson } from './generate-assemblies-json';
import { restoreDotNetTools } from './restore-dotnet-tools';
import { DocumentChangeTracker } from './document-change-tracker';

export class ConnectionEventHandler {
    connection: IConnection; 
    server_manager: ServerManager;
    documents: TextDocuments;
    config_event_emitter: ConfigEventEmitter;
    requester: Requester;
    edit_queue: EditQueue;
    config: GhulConfig;
    workspace_root: string;
    document_change_tracker: DocumentChangeTracker;

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

        connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) =>
            this.document_change_tracker?.onDidOpenTextDocument(params));

        connection.onDidCloseTextDocument((params: DidOpenTextDocumentParams) =>
            this.document_change_tracker?.onDidCloseTextDocument(params));

        connection.onDidChangeWatchedFiles((change: DidChangeWatchedFilesParams) =>
            this.document_change_tracker?.onDidChangeWatchedFiles(change));

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

    onInitialize(params: any): InitializeResult {
        this.workspace_root = params.rootPath;

        restoreDotNetTools(this.workspace_root)
        generateAssembliesJson(this.workspace_root);

        this.config = getGhulConfig(this.workspace_root);

        this.document_change_tracker = 
            new DocumentChangeTracker(
                this.edit_queue,
                this.config.source.map(glob => path.join(this.workspace_root, glob))
            );

        this.config_event_emitter.configAvailable(this.workspace_root, this.config);
        
        return {
            capabilities: {
                textDocumentSync: this.documents.syncKind,
                completionProvider: {
                    triggerCharacters: ['.'],                    
                    resolveProvider: false,                    
                },
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                hoverProvider: true,
                definitionProvider: true,
                // declarationProvider: true,
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
	    log("ghūl language extension: shutting down...");
	    this.server_manager.kill();
    }

    onExit() {
	    log("ghūl language extension: exit");
    }

    onDidChangeConfiguration(_change: DidChangeConfigurationParams) {
    }
    
    onDidChangeWatchedFiles(change: DidChangeWatchedFilesParams) {
        if (!change?.changes) {
            return;
        }

        for (let c of change.changes) {
            let fn = URI.parse(c.uri).fsPath;

            let globs = this.config.source.map(glob => { 
                if (path.isAbsolute(glob)) {

                    return glob;
                }

                return path.join(this.workspace_root, glob);
            });

            console.log("XXXXXX: on did change: " + c.type + " " + c.uri + " -> " + fn);
            console.log("XXXXXX: globs: " + JSON.stringify(globs));

            if (!globs
                .find(
                    glob => minimatch(fn, glob)
                )
            ) {
                console.log("XXXXXX: no glob matches: " + c.type + " " + c.uri);

                for (let glob of globs) {
                    console.log("XXXXXX: glob: '" + glob + "' fn: '" + fn + "' minimatch: " + minimatch(fn, glob));
                }
            }
            console.log("XXXXXX: on did change: " + c.type + " " + c.uri);
        }
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
