import {
    CompletionItem,
    Definition,
    Hover,
    SignatureHelp,
    SymbolInformation,
    Location
} from 'vscode-languageserver';

import { log } from './server';

import { ChildProcess } from 'child_process';

import { bodgeUri } from './bodge-uri';

import { ServerEventEmitter } from './server-event-emitter';

import { ResponseHandler } from './response-handler';

const version = require('./version') as string;

export class Requester {
    analysed: boolean;
    stream: any;    

    response_handler: ResponseHandler;

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
            log("caught exception trying to send, compiler may have died" + ex);
        }
    }
    
    sendDocument(uri: string, source: string) {
        console.log("send EDIT: " + uri);
        this.write('#EDIT#\n');
        this.write(bodgeUri(uri) + '\n');
        this.write(source);
        this.write('\f');
    }

    analyse(uris: string[]): void {
        console.log("send ANALYSE: " + uris.join(','));
        this.write('#ANALYSE#\n');
        for (let uri of uris) {
            this.write(uri + '\t');
        }
        this.write('\n');
    }

    sendHover(uri: string, line: number, character: number): Promise<Hover> {
        console.log("send HOVER: " + uri + " @ " + line + "," + character);
        if (this.analysed) {
            this.write('#HOVER#\n');
            this.write(bodgeUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character) + '\n');

            return this.response_handler.expectHover();
        } else {
            return null;
        }
    }

    sendDefinition(uri: string, line: number, character: number): Promise<Definition> {
        console.log("send DEFINITION: " + uri + " @ " + line + "," + character);
        if (this.analysed) {
            this.write('#DEFINITION#\n');
            this.write(bodgeUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectDefinition();
        } else {
            return null;
        }
    }

    sendCompletion(uri: string, line: number, character: number): Promise<CompletionItem[]> {
        console.log("send COMPLETE: " + uri + " @ " + line + "," + character);
        if (this.analysed) {
            this.write("#COMPLETE#\n");
            this.write(bodgeUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectCompletion();
        } else {
            return null;
        }
    }    

    sendSignature(uri: string, line: number, character: number): Promise<SignatureHelp> {
        console.log("send SIGNATURE: " + uri + " @ " + line + "," + character);
        if (this.analysed) {
            this.write('#SIGNATURE#\n');
            this.write(bodgeUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character+1) + '\n');

            return this.response_handler.expectSignature();
        } else {
            return null;
        }
    }
    
    sendDocumentSymbol(uri: string): Promise<SymbolInformation[]> {
        console.log("send SYMBOLS: " + uri);
        if (this.analysed) {
            this.write('#SYMBOLS#\n');
            this.write(bodgeUri(uri) + '\n');

            return this.response_handler.expectSymbols();            
        } else {
            return null;
        }
    }

    sendWorkspaceSymbol(): Promise<SymbolInformation[]> {
        console.log("send SYMBOLS: (all)");
        if (this.analysed) {
            this.write('#SYMBOLS#\n');
            this.write('\n');

            return this.response_handler.expectSymbols();            
        } else {
            return null;
        }
    }

    sendReferences(uri: string, line: number, character: number): Promise<Location[]> {
        console.log("send REFERENCES: " + uri + " @ " + line + "," + character);
        if (this.analysed) {
            this.write('#REFERENCES#\n');
            this.write(bodgeUri(uri) + '\n');
            this.write((line+1) + '\n');
            this.write((character) + '\n');

            return this.response_handler.expectReferences();
        } else {
            return null;
        }
    }

    sendRestart() {
        console.log("send RESTART");
        if (this.analysed) {
            this.write('#RESTART#\n');
        }        
    }
}
