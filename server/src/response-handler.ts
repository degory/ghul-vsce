import { IConnection, CompletionItem, CompletionItemKind, Definition, SignatureHelp, SymbolKind, Hover, SignatureInformation, ParameterInformation, SymbolInformation, Location } from 'vscode-languageserver';

import { log, rejectAllAndThrow } from './server';

import { bodgeUri } from './bodge-uri';

import { ProblemStore } from './problem-store';
import { SeverityMapper } from './severity-map';

import { ServerManager } from './server-manager';

import { EditQueue } from './edit-queue';

export class ResponseHandler {
    server_manager: ServerManager;
    connection: IConnection;
    problems: ProblemStore;
    edit_queue: EditQueue;

    hover_resolve: (value: Hover) => void;
    hover_reject: (error: any) => void;

    definition_resolve: (value: Definition) => void;
    definition_reject: (error: any) => void;

    completion_resolve: (value: CompletionItem[]) => void;
    completion_reject: (error: any) => void;

    signature_resolve: (value: SignatureHelp) => void;
    signature_reject: (error: any) => void;

    symbols_resolve: (value: SymbolInformation[]) => void;
    symbols_reject: (error: any) => void;

    references_resolve: (value: Location[]) => void;
    references_reject: (error: any) => void;

    constructor(
        connection: IConnection,
        problems: ProblemStore
    ) {
        this.connection = connection;
        this.problems = problems;
    }

    rejectAllPendingPromises(message: string) {
        if (this.hover_reject) {
            this.hover_reject(message);

            this.hover_resolve = null;
            this.hover_reject = null;
        }

        if (this.definition_reject) {
            this.definition_reject(message);

            this.definition_resolve = null;
            this.definition_reject = null;
        }

        if (this.completion_reject) {
            this.completion_reject(message);

            this.completion_resolve = null;
            this.completion_reject = null;
        }
        
        if (this.signature_reject) {
            this.signature_reject(message);

            this.signature_resolve = null;
            this.signature_reject = null;
        }        

        if (this.symbols_reject) {
            this.symbols_reject(message);

            this.symbols_resolve = null;
            this.symbols_reject = null;
        }        

        if (this.references_reject) {
            this.references_reject(message);

            this.references_resolve = null;
            this.references_reject = null;
        }        
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
        // this.edit_queue.listenReceived();
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
    }

    handleAnalysed() {
        for (let d of this.problems) {
            this.connection.sendDiagnostics(d);
        }

        this.edit_queue.onBuildFinished();
    }

    expectHover(): Promise<Hover> {
        return new Promise<Hover>((resolve, reject) => {
            if (this.hover_resolve) {
                log("oops: overlapped hover request");
                this.hover_resolve(null);
            }

            this.hover_resolve = resolve;
            this.hover_reject = reject;
        });
    }

    handleHover(lines: string[]) {
        let resolve = this.hover_resolve;
        this.hover_resolve = null;

        if (lines.length > 0 && lines[0] != null && lines[0].length > 0) {
            resolve({
                contents: { language: 'ghul', value: lines[0] }
            });
        } else {
            resolve(null);
        }
    }

    expectDefinition(): Promise<Definition> {
        return new Promise<Definition>((resolve, reject) => {
            if (this.definition_resolve) {
                log("oops: overlapped definition request");
                this.definition_resolve(null);
            }

            this.definition_resolve = resolve;
            this.definition_reject = reject;
        });
    }

    handleDefinition(lines: string[]) {
        let resolve = this.definition_resolve;
        this.definition_resolve = null;
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
    }

    expectCompletion(): Promise<CompletionItem[]> {
        return new Promise<CompletionItem[]>((resolve, reject) => {
            if (this.completion_resolve) {
                log("oops: overlapped completion request");
                this.completion_resolve(null);
            }
            this.completion_resolve = resolve;
            this.completion_reject = reject;
        });
    }

    handleCompletion(lines: string[]) {
        let reject = this.completion_reject;
        try {
            let resolve = this.completion_resolve;

            this.completion_resolve = null;
            this.completion_reject = null;

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
            
            if (resolve && typeof resolve === "function") {
                resolve(
                    results
                )
            } else {
                log("weird: received completion but completion promise is null or not a function: " + resolve);
            }
        } catch(e) {
            if (reject && typeof reject === "function") {
                log("rejecting completion: " + e);
                reject("" + e);
            } else {
                log(e);
            }
        }
    }    

    expectSignature(): Promise<SignatureHelp> {
        return new Promise<SignatureHelp>((resolve, reject) => {
            if (this.signature_resolve) {
                log("oops: overlapped signature request");
                this.signature_resolve(null);
            }
            this.signature_resolve = resolve;
            this.signature_reject = reject;
        });
    }

    handleSignature(lines: string[]) {
        let reject = this.signature_reject;

        try {
            let resolve = this.signature_resolve;
            this.signature_resolve = null;
            this.signature_resolve = null;

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
        return new Promise<SymbolInformation[]>((resolve, reject) => {
            if (this.symbols_resolve) {
                log("oops: overlapped symbols request");
                this.symbols_resolve(null);
            }
            this.symbols_resolve = resolve;
            this.symbols_reject = reject;
        });
    }

    handleSymbols(lines: string[]) {
        let resolve = this.symbols_resolve;
        this.symbols_resolve = null;

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
    }    
    
    expectReferences(): Promise<Location[]> {
        return new Promise<Location[]>((resolve, reject) => {
            if (this.references_resolve) {
                log("oops: overlapped references request");
                this.references_resolve(null);
            }
            
            this.references_resolve = resolve;
            this.references_reject = reject;
        });
    }

    handleReferences(lines: string[]) {
        let resolve = this.references_resolve;
        this.references_resolve = null;

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
    }        

    handleRestart() {
        console.log("#### compiler requests restart");

        this.edit_queue.restart();
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
                source: 'ghul'
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

