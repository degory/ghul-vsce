import { IConnection, CompletionItem, CompletionItemKind, Definition, SignatureHelp, SymbolKind, Hover, SignatureInformation, ParameterInformation, SymbolInformation, Location, WorkspaceEdit, TextEdit } from 'vscode-languageserver';

import { log, rejectAllAndThrow } from './server';

import { bodgeUri } from './bodge-uri';

import { ProblemStore } from './problem-store';
import { SeverityMapper } from './severity-map';

import { ServerManager } from './server-manager';

import { EditQueue } from './edit-queue';
import { ConfigEventEmitter } from './config-event-emitter';
import { GhulConfig } from './ghul-config';

type ResolveReject<T> = {
    resolve: (value: T) => void;
    reject: (error: any) => void;
}

class PromiseQueue<T> {
    _name: string;
    _queue: ResolveReject<T>[];

    constructor(name: string) {
        this._name = name;
        this._queue = [];
    }

    enqueue(): Promise<T> {
        console.log(this._name + ": enqueue");
        return new Promise<T>((resolve, reject) => {
            this._queue.push({resolve, reject});
        })
    }

    dequeue(): ResolveReject<T> {
        console.log(this._name + ": dequeue...");
        // compiler is guaranteed to respond to requests in the order they were
        // sent, so safe to just dequeue the next pending promise:
        return this._queue.shift();
    }

    dequeueAlways(): ResolveReject<T> {
        console.log(this._name + ": dequeue always");
        // compiler is guaranteed to respond to requests in the order they were
        // sent, so safe to just dequeue the next pending promise:
        return (
            this._queue.shift() ?? 
            {
                resolve: value => console.log(this._name + ": oops: unexpected resolve: " + JSON.stringify(value)),
                reject: error => console.log(this._name + ": oops: unexpected reject: " + error)
            }
        );
    }

    resolve(value: T) {
        console.log(this._name + ": will resolve: " + JSON.stringify(value));

        this.dequeueAlways().resolve(value);
    }

    reject(error: any) {
        console.log(this._name + ": will reject: " + error);

        this.dequeueAlways().reject(error);
    }

    resolveAll(value: T) {
        console.log(this._name + ": will resolve ALL: " + JSON.stringify(value));

        for (let entry = this.dequeue(); entry; entry = this.dequeue() ) {
            entry.resolve(value);
        }
    }

    rejectAll(error: any) {
        console.log(this._name + ": will reject ALL: " + error);

        for (let entry = this.dequeue(); entry; entry = this.dequeue() ) {
            entry.reject(error);
        }
    }
}

export class ResponseHandler {
    want_plaintext_hover: boolean;

    server_manager: ServerManager;
    connection: IConnection;
    problems: ProblemStore;
    edit_queue: EditQueue;

    _hover_promise_queue: PromiseQueue<Hover>;
    _definition_promise_queue: PromiseQueue<Definition>;
    _declaration_promise_queue: PromiseQueue<Definition>;
    _completion_promise_queue: PromiseQueue<CompletionItem[]>;
    _signature_promise_queue: PromiseQueue<SignatureHelp>;
    _symbols_promise_queue: PromiseQueue<SymbolInformation[]>;
    _references_promise_queue: PromiseQueue<Location[]>;
    _implementation_promise_queue: PromiseQueue<Location[]>;
    _rename_promise_queue: PromiseQueue<WorkspaceEdit>;

    constructor(
        connection: IConnection,
        problems: ProblemStore,
        config_event_source: ConfigEventEmitter
    ) {
        this.connection = connection;
        this.problems = problems;

		config_event_source.onConfigAvailable((_workspace: string, config: GhulConfig) => {
            this.want_plaintext_hover = config.want_plaintext_hover;
        });

        this._hover_promise_queue = new PromiseQueue<Hover>("HOVER");
        this._definition_promise_queue = new PromiseQueue<Definition>("DEFINITION");
        this._declaration_promise_queue = new PromiseQueue<Definition>("DECLARATION");
        this._completion_promise_queue = new PromiseQueue<CompletionItem[]>("COMPLETION");
        this._signature_promise_queue = new PromiseQueue<SignatureHelp>("SIGNATURE");
        this._symbols_promise_queue = new PromiseQueue<SymbolInformation[]>("SYMBOLS");
        this._references_promise_queue = new PromiseQueue<Location[]>("REFERENCES");
        this._implementation_promise_queue = new PromiseQueue<Location[]>("IMPLEMENTATION");
        this._rename_promise_queue = new PromiseQueue<WorkspaceEdit>("RENAMEREQUEST");
    }

    resolveAllPendingPromises() {
        this._hover_promise_queue.resolveAll(null);
        this._definition_promise_queue.resolveAll(null);
        this._declaration_promise_queue.resolveAll(null);
        this._completion_promise_queue.resolveAll(null);
        this._signature_promise_queue.resolveAll(null);
        this._symbols_promise_queue.resolveAll(null);
        this._references_promise_queue.resolveAll(null);
        this._implementation_promise_queue.resolveAll(null);
        this._rename_promise_queue.resolveAll(null);
    }

    rejectAllPendingPromises(message: string) {
        this._hover_promise_queue.rejectAll(message);
        this._definition_promise_queue.rejectAll(message);
        this._declaration_promise_queue.reject(message);
        this._completion_promise_queue.rejectAll(message);
        this._signature_promise_queue.rejectAll(message);
        this._symbols_promise_queue.rejectAll(message);
        this._references_promise_queue.rejectAll(message);
        this._implementation_promise_queue.rejectAll(message);
        this._rename_promise_queue.reject(message);
    }

    setServerManager(server_manager: ServerManager) {
        if (this.server_manager == null) {
            this.server_manager = server_manager;
        } else {
            rejectAllAndThrow("replacing existing server manager in ResponseHandler");
        }
    }

    setEditQueue(edit_queue: EditQueue) {
        if (this.edit_queue == null) {
            this.edit_queue = edit_queue;
        } else {
            rejectAllAndThrow("replacing existing edit queue in ResponseHandler");
        }
    }    

    handleListen() {
        this.server_manager.startListening();
    }

    handleExcept(lines: string[]) {
        var error = '';

        for (let l of lines) {
            error += l;
            log(l);
        }

        this.server_manager.abort();

        this.connection.window.showErrorMessage(error);
    }

    handleDiagnostics(kind: string, lines: string[]) {
        this.addDiagnostics(kind, lines);

        if (kind == "analysis") {
            for (let d of this.problems) {
                this.connection.sendDiagnostics(d);
            }
        }
    }

    expectHover(): Promise<Hover> {
        return this._hover_promise_queue.enqueue();
    }

    handleHover(lines: string[]) {
        let {resolve, reject} = this._hover_promise_queue.dequeueAlways();

        try {
            if (lines.length > 0 && lines[0] != null && lines[0].length > 0) {
                if (this.want_plaintext_hover) {
                    resolve({
                        contents: { kind: "plaintext", value: lines[0] }
                    });
                } else {
                    resolve({
                        contents: { language: "ghul", value: lines[0] }
                    });    
                }
            } else {
                resolve(null);
            }    
        } catch(e) {
            reject("" + e);
        }
    }

    expectDefinition(): Promise<Definition> {
        return this._definition_promise_queue.enqueue();
    }

    handleDefinition(lines: string[]) {
        let {resolve, reject} = this._definition_promise_queue.dequeueAlways();

        try {
            if (lines.length >= 5) {
                resolve({
                    uri: lines[0],
                    range: {
                        start: {
                            line: parseInt(lines[1], 10) - 1,
                            character: parseInt(lines[2], 10) - 1
                        },
                        end: {
                            line: parseInt(lines[3], 10) - 1,
                            character: parseInt(lines[4], 10) - 1
                        }
                    }
                });
            } else {
                resolve(null);
            }    
        } catch(e) {
            reject(e);
        }
    }

    expectDeclaration(): Promise<Definition> {
        return this._declaration_promise_queue.enqueue();
    }

    handleDeclaration(lines: string[]) {
        let {resolve, reject} = this._declaration_promise_queue.dequeueAlways();

        try {
            if (lines.length >= 5) {
                resolve({
                    uri: lines[0],
                    range: {
                        start: {
                            line: parseInt(lines[1], 10) - 1,
                            character: parseInt(lines[2], 10) - 1
                        },
                        end: {
                            line: parseInt(lines[3], 10) - 1,
                            character: parseInt(lines[4], 10) - 1
                        }
                    }
                });
            } else {
                resolve(null);
            }    
        } catch(e) {
            reject(e);
        }
    }

    expectCompletion(): Promise<CompletionItem[]> {
        return this._completion_promise_queue.enqueue();
    }

    handleCompletion(lines: string[]) {
        let {resolve, reject} = this._completion_promise_queue.dequeueAlways();

        try {
            let results: CompletionItem[] = [];

            for (let line of lines) {
                let fields = line.split('\t');

                if (fields.length >= 3) {
                    results.push({
                        label: fields[0],
                        kind:  <CompletionItemKind>parseInt(fields[1]),
                        detail: fields[2]
                    });
                }
            }
            
            resolve(results)
        } catch(e) {
            reject("" + e);
        }
    }    

    expectSignature(): Promise<SignatureHelp> {
        return this._signature_promise_queue.enqueue();
    }

    handleSignature(lines: string[]) {
        let {resolve, reject} = this._signature_promise_queue.dequeueAlways();

        try {
            let active_signature = 0;
            let active_parameter = 0;

            let signatures: SignatureInformation[] = [];

            if (lines.length > 0) {
                active_signature = parseInt(lines[0], 10);
                active_parameter = parseInt(lines[1], 10);

                for (let i = 2; i < lines.length; i++) {
                    let parameters: ParameterInformation[] = [];

                    let params_raw = lines[i].split('\t');

                    let signature_label = params_raw[0];

                    for (let j = 1; j < params_raw.length; j++) {
                        parameters.push({
                            label: params_raw[j]
                        });
                    }

                    signatures.push({
                        label: signature_label,
                        parameters: parameters,
                    });
                }
            }

            let result: SignatureHelp = {
                signatures: signatures,
                activeSignature: active_signature,
                activeParameter: active_parameter
            };

            resolve(
                result
            );
        } catch(e) {
            reject("" + e);
        }
    }    

    expectSymbols(): Promise<SymbolInformation[]> {
        return this._symbols_promise_queue.enqueue();
    }

    handleSymbols(lines: string[]) {
        let {resolve, reject} = this._symbols_promise_queue.dequeueAlways();

        try {
            let symbols: SymbolInformation[] = [];

            if (lines.length > 0) {
                let uri: string = "unknown";
                
                for (let i = 1; i < lines.length; i++) {
                    let line = lines[i];
                    let fields = line.split('\t');

                    if (fields.length == 1) {
                        uri = line;
                    } else {
                        let symbol: SymbolInformation = {
                            name: fields[0],
                            kind: <SymbolKind>parseInt(fields[1]),
                            location: {
                                uri: uri,
                                range: {
                                    start: {
                                        line: parseInt(fields[2]) - 1,
                                        character: parseInt(fields[3]) - 1
                                    },
                                    end: {
                                        line: parseInt(fields[4]) - 1,
                                        character: parseInt(fields[5]) - 1
                                    }
                                }
                            },
                            containerName: fields[6]
                        };

                        symbols.push(symbol);
                    }
                }
            }

            resolve(
                symbols
            );
        } catch(e) {
            reject("" + e);
        }
    }    
    
    expectReferences(): Promise<Location[]> {
        return this._references_promise_queue.enqueue();
    }

    handleReferences(lines: string[]) {
        let {resolve, reject} = this._references_promise_queue.dequeueAlways();

        try {
            let locations: Location[] = [];

            if (lines.length > 0) {
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    let fields = line.split('\t');

                    let location: Location = {
                        uri: fields[0],
                        range: {
                            start: {
                                line: parseInt(fields[1]) - 1,
                                character: parseInt(fields[2]) - 1
                            },
                            end: {
                                line: parseInt(fields[3]) - 1,
                                character: parseInt(fields[4])
                            }
                        }
                    };

                    locations.push(location);
                }
            }

            resolve(
                locations
            );
        } catch(e) {
            reject("" + e);
        }
    }        

    expectImplementation(): Promise<Location[]> {
        return this._implementation_promise_queue.enqueue();
    }

    handleImplementation(lines: string[]) {
        let {resolve, reject} = this._implementation_promise_queue.dequeueAlways();

        try {
            let locations: Location[] = [];

            if (lines.length > 0) {
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    let fields = line.split('\t');

                    let location: Location = {
                        uri: fields[0],
                        range: {
                            start: {
                                line: parseInt(fields[1]) - 1,
                                character: parseInt(fields[2]) - 1
                            },
                            end: {
                                line: parseInt(fields[3]) - 1,
                                character: parseInt(fields[4])
                            }
                        }
                    };

                    locations.push(location);
                }
            }

            resolve(
                locations
            );
        } catch(e) {
            reject("" + e);
        }
    }    

    expectRenameRequest(): Promise<WorkspaceEdit> {
        return this._rename_promise_queue.enqueue();
    }

    handleRenameRequest(lines: string[]) {
        let {resolve, reject} = this._rename_promise_queue.dequeueAlways();

        try {
            let changes: {
                [uri: string]: TextEdit[];
            } = {};

            console.log("have " + lines.length + " edits: " + JSON.stringify(lines));

            if (lines.length > 0) {
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    let fields = line.split('\t');

                    let uri = fields[0];

                    let edits = changes[uri];

                    if (!edits) {
                        edits = [];
                        changes[uri] = edits;
                    }

                    let edit = {
                        range: {
                            start: {
                                line: parseInt(fields[1]) - 1,
                                character: parseInt(fields[2]) - 1
                            },
                            end: {
                                line: parseInt(fields[3]) - 1,
                                character: parseInt(fields[4])
                            }
                        },
                        newText: fields[5]
                    };

                    edits.push(edit)
                }
            }

            console.log("have changes: " + JSON.stringify(changes));

            resolve(
                { changes }
            );
        } catch(e) {
            console.log("have caught: " + e);

            reject("" + e);
        }
    }    


    handleRestart() {
        console.log("compiler requested restart");
        this.edit_queue.reset();
    }
     
    handleUnexpected() {
        this.server_manager.abort();
    }

    addDiagnostics(kind: string, lines: string[]) {
        for (var i = 0; i < lines.length; i++) {
            let line = lines[i];

            let fields = line.split('\t');

            if (fields.length != 7) {
                continue;
            }

            let uri = bodgeUri(fields[0]);

            let problem = {
                severity: SeverityMapper.getSeverity(fields[5], kind),
                range: {
                    start: { line: Number(fields[1]) - 1, character: Number(fields[2]) - 1 },
                    end: { line: Number(fields[3]) - 1, character: Number(fields[4]) - 1 }
                },
                message: fields[6],
                source: 'ghūl'
            }

            this.problems.add(kind, uri, problem);
        }
    }

    /*
    connection.onDidOpenTextDocument((params) => {
        // A text document got opened in VSCode.
        // params.uri uniquely identifies the document. For documents store on disk this is a file URI.
        // params.text the initial full content of the document.
        connection.log(`${params.textDocument.uri} opened.`);
    });
    connection.onDidChangeTextDocument((params) => {
        // The content of a text document did change in VSCode.
        // params.uri uniquely identifies the document.
        // params.contentChanges describe the content changes to the document.
        connection.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
    });
    connection.onDidCloseTextDocument((params) => {
        // A text document got closed in VSCode.
        // params.uri uniquely identifies the document.
        connection.log(`${params.textDocument.uri} closed.`);
    });
    */

}

