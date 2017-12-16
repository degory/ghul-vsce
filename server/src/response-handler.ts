import { IConnection, CompletionItem, CompletionItemKind, Definition, SignatureHelp, SymbolKind, Hover, SignatureInformation, ParameterInformation, SymbolInformation } from 'vscode-languageserver';

import { log } from './server';

import { bodgeUri } from './bodge-uri';

import { ProblemStore } from './problem-store';
import { SeverityMap } from './severity-map';

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

    constructor(
        connection: IConnection,
        problems: ProblemStore
    ) {
        this.connection = connection;
        this.problems = problems;
    }

    setServerManager(server_manager: ServerManager) {
        if (this.server_manager == null) {
            this.server_manager = server_manager;
        } else {
            throw "replacing existing server manager in ResponseHandler";
        }
    }

    setEditQueue(edit_queue: EditQueue) {
        if (this.edit_queue == null) {
            this.edit_queue = edit_queue;
        } else {
            throw "replacing existing server manager in ResponseHandler";
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
    }

    handleAnalysed() {
        for (let d of this.problems) {
            this.connection.sendDiagnostics(d);
        }

        this.edit_queue.buildFinished();
    }

    expectHover(): Promise<Hover> {
        return new Promise<Hover>((resolve, reject) => {
            this.hover_resolve = resolve;
            this.hover_reject = reject;
        });
    }

    handleHover(lines: string[]) {
        let resolve = this.hover_resolve;
        this.hover_resolve = null;
        resolve({
            contents: { language: 'ghul', value: lines[0] }
        });
    }

    expectDefinition(): Promise<Definition> {
        return new Promise<Definition>((resolve, reject) => {
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
        log("response handler: returning promise for pending completion");
        return new Promise<CompletionItem[]>((resolve, reject) => {
            this.completion_resolve = resolve;
            this.completion_reject = reject;
        });
    }

    handleCompletion(lines: string[]) {
        let resolve = this.completion_resolve;
        this.completion_resolve = null;

        let results: CompletionItem[] = [];

        for (let line of lines) {
            let fields = line.split('\t');
            results.push({
                label: fields[0],
                kind:  <CompletionItemKind>parseInt(fields[1]),
                detail: fields[2]
            });
        }
        
        resolve(
            results
        );
    }    

    expectSignature(): Promise<SignatureHelp> {
        return new Promise<SignatureHelp>((resolve, reject) => {
            this.signature_resolve = resolve;
            this.signature_reject = reject;
        });
    }

    handleSignature(lines: string[]) {
        let resolve = this.signature_resolve;
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

        log("signature help\n" + JSON.stringify(result));
        
        resolve(
            result
        );
    }    

    expectSymbols(): Promise<SymbolInformation[]> {
        return new Promise<SymbolInformation[]>((resolve, reject) => {
            this.symbols_resolve = resolve;
            this.symbols_reject = reject;
        });
    }

    handleSymbols(lines: string[]) {
        let resolve = this.symbols_resolve;
        this.symbols_resolve = null;

        let symbols: SymbolInformation[] = [];

        if (lines.length > 0) {
            let uri = lines[0];

            for (let i = 1; i < lines.length; i++) {
                let fields = lines[i].split('\t');

                let symbol: SymbolInformation = {
                    name: fields[0],
                    kind: <SymbolKind>parseInt(fields[1]),
                    location: {
                        uri: uri,
                        range: {
                            start: {
                                line: parseInt(fields[2]),
                                character: parseInt(fields[3])
                            },
                            end: {
                                line: parseInt(fields[4]),
                                character: parseInt(fields[5])
                            }
                        }
                    },
                    containerName: fields[6]
                };

                symbols.push(symbol);
            }
        }

        log("document symbols\n" + JSON.stringify(symbols));
        
        resolve(
            symbols
        );
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
                severity: SeverityMap.get(fields[5]),
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

