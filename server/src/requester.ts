import {
    CompletionItem,
    Definition,
    Hover,
    SemanticTokens,
    InlayHint,
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

import { Watchdog } from './watchdog';

const version = require('./version') as string;

export class Requester {
    // True once the compiler has analysed the project at least once since it
    // (re)started. Queries sent before that would reach an analyser with no
    // source files registered: it can't answer them usefully, and the
    // query-driven recompile of an empty project corrupts its reflected-type
    // state. Every query sender below checks this and returns null instead.
    // The edit queue sets it when a compile round-trip completes.
    analysed: boolean;
    stream: any;

    response_handler: ResponseHandler;
    watchdog: Watchdog;

    watchdog_timer: NodeJS.Timer;

    constructor(
        server_event_emitter: ServerEventEmitter,
        response_handler: ResponseHandler,
        watchdog: Watchdog
    ) {
        this.response_handler = response_handler;
        this.watchdog = watchdog;
        this.analysed = false;

        server_event_emitter.onStarting(() => {
            // A fresh compiler child starts with no project state; hold
            // queries until its first compile completes.
            this.analysed = false;
        });

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
            this.response_handler.rejectAllAndThrow(ex);
        }
    }

    // Serialize one request object to a single JSONL line (newline-terminated).
    // JSON escapes any embedded newlines, so one line is always one message.
    send(request: object) {
        this.write(JSON.stringify(request) + '\n');
    }

    sendDocuments(documents: { uri: string, source: string }[]) {
        this.watchdog.startWatchdogIfNotRunning();

        this.send({
            command: "edit",
            files: documents.map(({ uri, source }) => ({
                path: normalizeFileUri(uri),
                source: source
            }))
        });
    }

    // Declare the client's currently-open files. Fire-and-forget: the analyser
    // records the set and only produces editor-only hints (invisible for a file
    // the user is not viewing) for these paths. There is no response frame, so
    // this must not arm the watchdog. Dropped silently before the child is
    // running — the cold-start analyse re-sends the set once it is.
    sendOpenFiles(uris: string[]) {
        if (!this.stream) {
            return;
        }

        this.send({
            command: "set_open_files",
            paths: uris.map(uri => normalizeFileUri(uri))
        });
    }

    sendHover(uri: string, line: number, character: number): Promise<Hover> {
        if (this.analysed) {
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

            this.send({
                command: "semantic_tokens",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectSemanticTokens();
        } else {
            return null;
        }
    }

    sendInlayHints(uri: string): Promise<InlayHint[]> {
        if (this.analysed) {
            this.watchdog.startWatchdogIfNotRunning();

            this.send({
                command: "inlay_hints",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectInlayHints();
        } else {
            return Promise.resolve([]);
        }
    }

    sendDocumentFormatting(uri: string, source: string, range: Range): Promise<TextEdit[]> {
        if (this.analysed) {
            this.watchdog.startWatchdogIfNotRunning();

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
            this.watchdog.startWatchdogIfNotRunning();

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
        this.watchdog.startWatchdogIfNotRunning();

        this.send({ command: "compile" });
    }

    // Ask the analyser to sample the heap. The EditQueue sends this during a
    // lull in editing, so the watchdog's forced GC stays off the latency path
    // of interactive requests.
    sendHeapCheckRequest() {
        this.watchdog.startWatchdogIfNotRunning();

        this.send({ command: "heap_check" });
    }

    sendRestart() {
        if (this.analysed) {
            this.watchdog.startWatchdogIfNotRunning();

            this.send({ command: "restart" });
        }
    }
}
