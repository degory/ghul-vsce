import {
    CompletionItem,
    Definition,
    Hover,
    SemanticTokens,
    SignatureHelp,
    SymbolInformation,
    Location,
    WorkspaceEdit,
    TextEdit,
    Range
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

    // Serialize one request object to a single JSONL line (newline-terminated).
    // JSON escapes any embedded newlines, so one line is always one message.
    send(request: object) {
        this.write(JSON.stringify(request) + '\n');
    }

    sendDocuments(documents: { uri: string, source: string }[]) {
        startWatchdogIfNotRunning();

        this.send({
            command: "edit",
            files: documents.map(({ uri, source }) => ({
                path: normalizeFileUri(uri),
                source: source
            }))
        });
    }

    sendHover(uri: string, line: number, character: number): Promise<Hover> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "hover",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectHover();
        } else {
            return null;
        }
    }

    sendDefinition(uri: string, line: number, character: number): Promise<Definition> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "definition",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectDefinition();
        } else {
            return null;
        }
    }

    sendDeclaration(uri: string, line: number, character: number): Promise<Definition> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "declaration",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectDeclaration();
        } else {
            return null;
        }
    }

    sendCompletion(uri: string, line: number, character: number): Promise<CompletionItem[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "complete",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectCompletion();
        } else {
            return null;
        }
    }

    sendSignature(uri: string, line: number, character: number): Promise<SignatureHelp> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "signature",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectSignature();
        } else {
            return null;
        }
    }

    sendDocumentSymbol(uri: string): Promise<SymbolInformation[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "symbols",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectSymbols();
        } else {
            return null;
        }
    }

    sendWorkspaceSymbol(): Promise<SymbolInformation[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "symbols",
                path: ""
            });

            return this.response_handler.expectSymbols();
        } else {
            return null;
        }
    }

    sendReferences(uri: string, line: number, character: number): Promise<Location[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "references",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectReferences();
        } else {
            return null;
        }
    }

    sendImplementation(uri: string, line: number, character: number): Promise<Location[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "implementation",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectImplementation();
        } else {
            return null;
        }
    }

    sendTypeDefinition(uri: string, line: number, character: number): Promise<Definition> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "type_definition",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectTypeDefinition();
        } else {
            return null;
        }
    }

    sendRenameRequest(uri: string, line: number, character: number, newName: string): Promise<WorkspaceEdit> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "rename",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1,
                new_name: newName
            });

            return this.response_handler.expectRenameRequest();
        } else {
            return null;
        }
    }

    sendSemanticTokens(uri: string): Promise<SemanticTokens> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "semantic_tokens",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectSemanticTokens();
        } else {
            return null;
        }
    }

    sendDocumentFormatting(uri: string, source: string, range: Range): Promise<TextEdit[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "format",
                path: normalizeFileUri(uri),
                source: source
            });

            return this.response_handler.expectDocumentFormatting(range);
        } else {
            return null;
        }
    }

    sendDocumentRangeFormatting(uri: string, source: string, range: Range): Promise<TextEdit[]> {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({
                command: "format_range",
                path: normalizeFileUri(uri),
                start_line: range.start.line + 1,
                start_column: range.start.character + 1,
                end_line: range.end.line + 1,
                end_column: range.end.character + 1,
                source: source
            });

            return this.response_handler.expectDocumentRangeFormatting();
        } else {
            return null;
        }
    }

    sendFullCompileRequest() {
        startWatchdogIfNotRunning();

        this.send({ command: "compile" });
    }

    // Ask the analyser to sample the heap. The EditQueue sends this during a
    // lull in editing, so the watchdog's forced GC stays off the latency path
    // of interactive requests.
    sendHeapCheckRequest() {
        startWatchdogIfNotRunning();

        this.send({ command: "heap_check" });
    }

    sendRestart() {
        if (this.analysed) {
            startWatchdogIfNotRunning();

            this.send({ command: "restart" });
        }
    }
}
