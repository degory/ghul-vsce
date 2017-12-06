import {
    CompletionItem,
    Definition,
    Hover,
    SignatureHelp
} from 'vscode-languageserver';

import { ChildProcess } from 'child_process';

import { bodgeUri } from './bodge-uri';

import { ServerEventEmitter } from './server-event-emitter';

import { ResponseHandler } from './response-handler';

export class Requester {
    analysed: boolean;
    // queue: RequestQueue;
    stream: any;    

    response_handler: ResponseHandler;

    constructor(
        server_event_emitter: ServerEventEmitter,
        response_handler: ResponseHandler
    ) {
        this.response_handler = response_handler;

        this.analysed = false;

        server_event_emitter.onAnalysed(() => {
            this.analysed = true;
        });

        server_event_emitter.onRunning((child: ChildProcess) => {
            console.log("now running");
            this.stream = child.stdin;
            console.log("queued requests sent");
        });        
    }
    
    sendDocument(uri: string, source: string) {
        console.log("send document: " + bodgeUri(uri));

        this.stream.write('EDIT\n');
        this.stream.write(bodgeUri(uri) + '\n');
        this.stream.write(source);
        this.stream.write('\f');
    }

    analyse(): void {
        console.log("analyse project");
        this.stream.write('ANALYSE\n');
    }

    sendHover(uri: string, line: number, character: number): Promise<Hover> {
        if (this.analysed) {
            this.stream.write('HOVER\n');
            this.stream.write(bodgeUri(uri) + '\n');
            this.stream.write((line+1) + '\n');
            this.stream.write((character) + '\n');

            return this.response_handler.expectHover();
        } else {
            return null;
        }
    }

    sendDefinition(uri: string, line: number, character: number): Promise<Definition> {
        if (this.analysed) {
            this.stream.write('DEFINITION\n');
            this.stream.write(bodgeUri(uri) + '\n');
            this.stream.write((line+1) + '\n');
            this.stream.write((character+1) + '\n');

            return this.response_handler.expectDefinition();
        } else {
            return null;
        }
    }

    sendCompletion(uri: string, line: number, character: number): Promise<CompletionItem[]> {
        console.log("send complete request...");

        if (this.analysed) {
            this.stream.write("COMPLETE\n");
            this.stream.write(bodgeUri(uri) + '\n');
            this.stream.write((line+1) + '\n');
            this.stream.write((character+1) + '\n');

            return this.response_handler.expectCompletion();
        } else {
            return null;
        }
    }    

    sendSignature(uri: string, line: number, character: number): Promise<SignatureHelp> {
        if (this.analysed) {
            this.stream.write('SIGNATURE\n');
            this.stream.write(bodgeUri(uri) + '\n');
            this.stream.write((line+1) + '\n');
            this.stream.write((character+1) + '\n');

            return this.response_handler.expectSignature();
        } else {
            return null;
        }
    }    
}
