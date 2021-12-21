import { IConnection, CompletionItem, CompletionItemKind, Definition, SignatureHelp, SymbolKind, Hover, SignatureInformation, ParameterInformation, SymbolInformation, Location } from 'vscode-languageserver';

import { log, rejectAllAndThrow } from './server';

import { bodgeUri } from './bodge-uri';

import { ProblemStore } from './problem-store';
import { SeverityMapper } from './severity-map';

import { ServerManager } from './server-manager';

import { EditQueue } from './edit-queue';
import { ConfigEventEmitter } from './config-event-emitter';
import { GhulConfig } from './ghul-config';

export class ResponseHandler {
    want_plaintext_hover: boolean;

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
        problems: ProblemStore,
        config_event_source: ConfigEventEmitter
    ) {
        this.connection = connection;
        this.problems = problems;

		config_event_source.onConfigAvailable((_workspace: string, config: GhulConfig) => {
            this.want_plaintext_hover = config.want_plaintext_hover;
        });
    }

    resolveAllPendingPromises() {
        if (this.hover_resolve) {
            this.hover_resolve(null);

            this.hover_resolve = null;
            this.hover_reject = null;
        }

        if (this.definition_resolve) {
            this.definition_resolve(null);

            this.definition_resolve = null;
            this.definition_reject = null;
        }

        if (this.completion_resolve) {
            this.completion_resolve(null);

            this.completion_resolve = null;
            this.completion_reject = null;
        }
        
        if (this.signature_resolve) {
            this.signature_resolve(null);

            this.signature_resolve = null;
            this.signature_reject = null;
        }        

        if (this.symbols_resolve) {
            this.symbols_resolve(null);

            this.symbols_resolve = null;
            this.symbols_reject = null;
        }        

        if (this.references_resolve) {
            this.references_resolve(null);

            this.references_resolve = null;
            this.references_reject = null;
        }        
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

        if (!resolve) {
            log("oops: unexpected hover response: ignoring");
            return;
        }

        this.hover_resolve = null;

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
    }

    expectDefinition(): Promise<Definition> {
        return new Promise<Definition>((resolve, reject) => {
            if (this.definition_resolve) {
                log("oops: overlapped definition request: cancelling");
                this.definition_resolve(null);
            }

            this.definition_resolve = resolve;
            this.definition_reject = reject;
        });
    }

    handleDefinition(lines: string[]) {
        let resolve = this.definition_resolve;

        if (!resolve) {
            log("oops: unexpected definition response: ignoring");
            return;
        }

        this.definition_resolve = null;
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
    }

    expectCompletion(): Promise<CompletionItem[]> {
        return new Promise<CompletionItem[]>((resolve, reject) => {
            if (this.completion_resolve) {
                log("oops: overlapped completion request: cancelling");
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

            if (!resolve) {
                log("oops: unexpected completion response: ignoring");
                return;
            }
    
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
                log("oops: overlapped signature request: cancelling");
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

            if (!resolve) {
                log("oops: unexpected signature response: ignoring");
                return;
            }
    
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
                log("oops: overlapped symbols request: cancelling");
                this.symbols_resolve(null);
            }
            this.symbols_resolve = resolve;
            this.symbols_reject = reject;
        });
    }

    handleSymbols(lines: string[]) {
        let resolve = this.symbols_resolve;

        if (!resolve) {
            log("oops: unexpected symbols response: ignoring");
            return;
        }

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
                log("oops: overlapped references request: cancelling");
                this.references_resolve(null);
            }
            
            this.references_resolve = resolve;
            this.references_reject = reject;
        });
    }

    handleReferences(lines: string[]) {
        let resolve = this.references_resolve;

        if (!resolve) {
            log("oops: unexpected references response: ignoring");
            return;
        }

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

