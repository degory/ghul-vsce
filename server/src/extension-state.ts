
import {
    Connection,
	TextDocuments
} from 'vscode-languageserver';

import {
	createConnection
} from 'vscode-languageserver/node'

import { ConnectionEventHandler } from './connection-event-handler';

import { Requester } from './requester';

import { EditQueue } from './edit-queue';

import { ServerEventEmitter } from './server-event-emitter';

import { ResponseHandler } from './response-handler';

import { ResponseParser } from './response-parser';

import { ConfigEventEmitter } from './config-event-emitter';

import { GhulAnalyser } from './ghul-analyser';

import { ServerManager } from './server-manager';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { log } from './log';

export class ExtensionState {
    private static instance: ExtensionState;

    public server_event_emitter: ServerEventEmitter;
    public config_event_emitter: ConfigEventEmitter;
    
    public connection: Connection;
    
    public response_handler: ResponseHandler;
    
    public requester: Requester;
    
    public edit_queue: EditQueue;
    
    public response_parser: ResponseParser;
    
    public server_manager: ServerManager;
    
    public documents: TextDocuments<TextDocument>;
    
    public connection_event_handler: ConnectionEventHandler;

    public resolveAllPendingPromises() {
        this.response_handler.resolveAllPendingPromises();
    }
    
    public rejectAllPendingPromises(message: string) {
        this.response_handler.rejectAllPendingPromises(message);
    }
    
    public rejectAllAndThrow(message: string) {
        log(message);

        this.rejectAllPendingPromises(message);
        throw message;
    }

    public reinitialize() {
        this.connection_event_handler.initialize();
    }

    private constructor() {
        log("ExtensionState constructor...")
    }

    public connect() {
        log("ExtensionState connect...")

        this.server_event_emitter = new ServerEventEmitter();
        this.config_event_emitter = new ConfigEventEmitter();
        
        this.connection = createConnection()
        
        this.response_handler = new ResponseHandler(
            this.connection,
            this.config_event_emitter
        );
        
        this.requester = new Requester(this.server_event_emitter, this.response_handler);
        
        this.edit_queue = new EditQueue(this.requester);
        
        new GhulAnalyser(
            this.edit_queue,
            this.config_event_emitter,
            this.server_event_emitter
        );
        
        this.response_parser = new ResponseParser(this.response_handler);
        
        this.server_manager = new ServerManager(
            this.config_event_emitter,
            this.server_event_emitter,
            this.edit_queue,
            this.response_parser	
        );
        
        this.response_handler.setServerManager(this.server_manager);
        this.response_handler.setEditQueue(this.edit_queue);

        this.documents = new TextDocuments(TextDocument);
        
        this.documents.onDidChangeContent((change) => {
            this.edit_queue.queueEdit(change);
        });

        this.connection_event_handler = new ConnectionEventHandler(
            this.connection,
            this.server_manager,
            this.documents,
            this.config_event_emitter,
            this.requester,
            this.edit_queue
        );
        

        this.documents.listen(this.connection);
        this.connection.listen();

        log("ExtensionState listening...");        
    }

    public static getInstance(): ExtensionState {
        log("ExtensionState getInstance...");

        if (!ExtensionState.instance) {
            log("ExtensionState getInstance: creating new instance...");

            ExtensionState.instance = new ExtensionState();
        }

        log("ExtensionState getInstance: returning instance...");

        return ExtensionState.instance;
    }
}

export function resolveAllPendingPromises() {
    ExtensionState.getInstance().resolveAllPendingPromises();
}

export function rejectAllPendingPromises(message: string) {
    ExtensionState.getInstance().rejectAllPendingPromises(message);
}

export function rejectAllAndThrow(message: string) {
    ExtensionState.getInstance().rejectAllAndThrow(message);
}

export function reinitialize() {
    ExtensionState.getInstance().reinitialize();
}

