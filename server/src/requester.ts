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

// Long enough to cover a cold start on a machine that has to fetch and JIT the
// compiler first, short enough that a query against a compiler which will
// never answer does not hang indefinitely.
const ANALYSED_WAIT_TIMEOUT_MS = 60000;

export class Requester {
    // True once the compiler has analysed the project at least once since it
    // (re)started. Queries sent before that would reach an analyser with no
    // source files registered: it can't answer them usefully, and the
    // query-driven recompile of an empty project corrupts its reflected-type
    // state. Every query sender below goes through whenAnalysed, which holds
    // the query until this turns true. The edit queue sets it when a compile
    // round-trip completes.
    get analysed(): boolean {
        return this._analysed;
    }

    set analysed(value: boolean) {
        this._analysed = value;

        if (value) {
            this.releaseAnalysedWaiters();
        }
    }

    private _analysed: boolean;
    private analysed_waiters: (() => void)[] = [];

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

    // Hold a query that arrived before the analyser could answer it until it
    // can, rather than answering it with nothing. An empty answer is
    // indistinguishable from a real one: the client caches it and does not ask
    // again until the document changes, so a hover tried once during start-up
    // stays blank long after the analyser is ready, and reads as a feature
    // that does not work.
    //
    // Bounded, because the analyser might never arrive — a compiler that
    // cannot start, or one the watchdog is still recovering. Falling back to
    // the empty answer then is no worse than giving it immediately.
    private whenAnalysed<T>(send: () => Promise<T>, fallback: T = null): Promise<T> {
        if (this.analysed) {
            this.watchdog.startWatchdogIfNotRunning();

            return send();
        }

        return new Promise<T>(resolve => {
            const timer = setTimeout(() => {
                this.analysed_waiters = this.analysed_waiters.filter(w => w !== waiter);

                log("query timed out waiting for the analyser to become ready");

                resolve(fallback);
            }, ANALYSED_WAIT_TIMEOUT_MS);

            const waiter = () => {
                clearTimeout(timer);

                this.watchdog.startWatchdogIfNotRunning();

                resolve(send());
            };

            this.analysed_waiters.push(waiter);
        });
    }

    // Release everything waiting on the analyser. Called when the first
    // compile lands; the send and the matching expect stay adjacent within
    // each waiter, so the response handler's queues keep their pairing.
    private releaseAnalysedWaiters() {
        const waiters = this.analysed_waiters;

        this.analysed_waiters = [];

        for (const waiter of waiters) {
            waiter();
        }
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
        return this.whenAnalysed(() => {
            this.send({
                command: "hover",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectHover();
        });
    }

    sendDefinition(uri: string, line: number, character: number): Promise<Definition> {
        return this.whenAnalysed(() => {
            this.send({
                command: "definition",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectDefinition();
        });
    }

    sendDeclaration(uri: string, line: number, character: number): Promise<Definition> {
        return this.whenAnalysed(() => {
            this.send({
                command: "declaration",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectDeclaration();
        });
    }

    sendCompletion(uri: string, line: number, character: number): Promise<CompletionItem[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "complete",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectCompletion();
        });
    }

    sendSignature(uri: string, line: number, character: number): Promise<SignatureHelp> {
        return this.whenAnalysed(() => {
            this.send({
                command: "signature",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectSignature();
        });
    }

    sendDocumentSymbol(uri: string): Promise<SymbolInformation[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "symbols",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectSymbols();
        });
    }

    sendWorkspaceSymbol(): Promise<SymbolInformation[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "symbols",
                path: ""
            });

            return this.response_handler.expectSymbols();
        });
    }

    sendReferences(uri: string, line: number, character: number): Promise<Location[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "references",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectReferences();
        });
    }

    sendImplementation(uri: string, line: number, character: number): Promise<Location[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "implementation",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectImplementation();
        });
    }

    sendTypeDefinition(uri: string, line: number, character: number): Promise<Definition> {
        return this.whenAnalysed(() => {
            this.send({
                command: "type_definition",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectTypeDefinition();
        });
    }

    sendRenameRequest(uri: string, line: number, character: number, newName: string): Promise<WorkspaceEdit> {
        return this.whenAnalysed(() => {
            this.send({
                command: "rename",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1,
                new_name: newName
            });

            return this.response_handler.expectRenameRequest();
        });
    }

    sendSemanticTokens(uri: string): Promise<SemanticTokens> {
        return this.whenAnalysed(() => {
            this.send({
                command: "semantic_tokens",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectSemanticTokens();
        });
    }

    sendInlayHints(uri: string): Promise<InlayHint[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "inlay_hints",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectInlayHints();
        }, []);
    }

    sendDocumentFormatting(uri: string, source: string, range: Range): Promise<TextEdit[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "format",
                path: normalizeFileUri(uri),
                source: source
            });

            return this.response_handler.expectDocumentFormatting(range);
        });
    }

    sendDocumentRangeFormatting(uri: string, source: string, range: Range): Promise<TextEdit[]> {
        return this.whenAnalysed(() => {
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
        });
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
