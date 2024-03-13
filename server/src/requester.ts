import {
    CompletionItem,
    Definition,
    Hover,
    SignatureHelp,
    SymbolInformation,
    Location,
    WorkspaceEdit
} from 'vscode-languageserver';

import { log } from './log';

import { ChildProcess } from 'child_process';

import { normalizeFileUri } from './normalize-file-uri';

import { ServerEventEmitter } from './server-event-emitter';

import { ResponseHandler } from './response-handler';

import { rejectAllAndThrow, startWatchdogIfNotRunning } from './extension-state';

const version = require('./version') as string;

export class Requester {
    analysed: boolean;
    stream: any;    

    response_handler: ResponseHandler;

    watchdog_timer: NodeJS.Timer;

    constructor(
        server_event_emitter: ServerEventEmitter,
        response_handler: ResponseHandler
    ) {
        this.response_handler = response_handler;
        this.analysed = true;

        server_event_emitter.onRunning((child: ChildProcess) => {
            log(`ghūl language extension v${version}: initialized`);
            this.stream = child.stdin;
        });        
    }

    write(text: String) {
        try {
            this.stream.write(text);
        } catch(ex) {            
            log("caught exception trying to send request data: compiler may have died:" + ex);
            rejectAllAndThrow(ex);
        }
    }
    
    sendDocuments(documents: { uri: string, source: string }[]) {        
        startWatchdogIfNotRunning();

        this.write('#EDIT#\n');

        for (let { uri } of documents) {
            this.write(normalizeFileUri(uri) + '\n');
        }

        this.write('\n');

        for (let { source } of documents) {
            this.write(source);
            this.write('\f');
        }
    }

    sendDocument(uri: string, source: string) {
        startWatchdogIfNotRunning();

        this.write('#EDIT#\n');
        this.write(normalizeFileUri(uri) + '\n');
        this.write('\n');
        this.write(source);
        this.write('\f');
    }

    sendHover(uri: string, line: number, character: number): Promise<Hover> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#HOVER#\n');
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectHover();
        } else {
            return null;
        }
    }

    sendDefinition(uri: string, line: number, character: number): Promise<Definition> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#DEFINITION#\n');
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectDefinition();
        } else {
            return null;
        }
    }

    sendDeclaration(uri: string, line: number, character: number): Promise<Definition> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#DECLARATION#\n');
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectDeclaration();
        } else {
            return null;
        }
    }

    sendCompletion(uri: string, line: number, character: number): Promise<CompletionItem[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write("#COMPLETE#\n");
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectCompletion();
        } else {
            return null;
        }
    }    

    sendSignature(uri: string, line: number, character: number): Promise<SignatureHelp> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#SIGNATURE#\n');
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectSignature();
        } else {
            return null;
        }
    }
    
    sendDocumentSymbol(uri: string): Promise<SymbolInformation[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#SYMBOLS#\n');
            this.write(normalizeFileUri(uri) + '\n');

            return this.response_handler.expectSymbols();            
        } else {
            return null;
        }
    }

    sendWorkspaceSymbol(): Promise<SymbolInformation[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#SYMBOLS#\n');
            this.write('\n');

            return this.response_handler.expectSymbols();            
        } else {
            return null;
        }
    }

    sendReferences(uri: string, line: number, character: number): Promise<Location[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#REFERENCES#\n');
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectReferences();
        } else {
            return null;
        }
    }

    sendImplementation(uri: string, line: number, character: number): Promise<Location[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#IMPLEMENTATION#\n');
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectImplementation();
        } else {
            return null;
        }
    }

    sendRenameRequest(uri: string, line: number, character: number, newName: string): Promise<WorkspaceEdit> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#RENAMEREQUEST#\n');
            this.write(normalizeFileUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');
            this.write(newName + '\n');

            return this.response_handler.expectRenameRequest();
        } else {
            return null;
        }
    }

    sendFullCompileRequest() {
        startWatchdogIfNotRunning();

        this.write('#COMPILE#\n');
    }
 
    sendRestart() {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.write('#RESTART#\n');
        }        
    }
}
