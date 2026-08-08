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
    Range,
    CancellationToken
} from 'vscode-languageserver';

import { log } from './log';

import { ChildProcess } from 'child_process';

import { normalizeFileUri } from './normalize-file-uri';

import { ServerEventEmitter } from './server-event-emitter';

import { DiagnosticDto, ResponseHandler } from './response-handler';

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

    // Wakes a compiler that exited while idle. Every send calls it; it does
    // nothing unless the compiler is actually away.
    ensure_running: () => void;

    watchdog_timer: NodeJS.Timer;

    constructor(
        server_event_emitter: ServerEventEmitter,
        response_handler: ResponseHandler,
        watchdog: Watchdog,
        ensure_running: () => void = () => {}
    ) {
        this.response_handler = response_handler;
        this.watchdog = watchdog;
        this.ensure_running = ensure_running;
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
    private whenAnalysed<T>(
        send: () => Promise<T>,
        fallback: T = null,
        token?: CancellationToken
    ): Promise<T> {
        // A query is exactly the "something to ask" an idle exit was waiting
        // for. Waking here rather than on a timer is the point of the idle
        // exit: the relaunch is paid for by a request that wants an answer.
        // The wait below then covers the cold start, as it already does for a
        // compiler that is starting for any other reason.
        this.ensure_running();

        if (this.analysed) {
            this.watchdog.startWatchdogIfNotRunning();

            return send();
        }

        return new Promise<T>(resolve => {
            const drop = () => {
                this.analysed_waiters = this.analysed_waiters.filter(w => w !== waiter);

                clearTimeout(timer);
            };

            const timer = setTimeout(() => {
                drop();

                log("query timed out waiting for the analyser to become ready");

                resolve(fallback);
            }, ANALYSED_WAIT_TIMEOUT_MS);

            // The client withdraws a query as soon as it stops wanting the
            // answer — a hover the pointer has moved off, a completion the
            // user dismissed. Sending it when the analyser eventually comes up
            // would spend a round trip on an answer nobody reads, and every
            // such query released at once lands exactly when the analyser is
            // busiest with its first compile.
            token?.onCancellationRequested(() => {
                drop();

                resolve(fallback);
            });

            const waiter = () => {
                clearTimeout(timer);

                this.watchdog.startWatchdogIfNotRunning();

                resolve(send());
            };

            this.analysed_waiters.push(waiter);
        });
    }

    // Resolves once the analyser completes its first compile since this
    // requester was created — immediately, if that has already happened.
    // Distinct from whenAnalysed: this holds no query and sends nothing of
    // its own, so it has no fallback and no timeout of its own — it exists so
    // start-up progress reporting can stay open through the analyser's first
    // compile rather than ending the moment it spawns; the caller bounds it.
    untilFirstAnalysed(): Promise<void> {
        if (this.analysed) {
            return Promise.resolve();
        }

        return new Promise(resolve => this.analysed_waiters.push(resolve));
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
        // Editing is the other way work arrives. A relaunch re-primes the
        // analyser with the open documents on its own, so the wake matters
        // here even though this particular edit may land on a stream that is
        // already gone.
        this.ensure_running();

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

    // Quick fixes for the diagnostics of one file overlapping one range.
    // Gated on the compiler advertising "code-actions": an analyser that
    // does not know the command would leave the request unanswered and
    // wedge the queue until the watchdog killed it, so an older compiler
    // means no quick fixes rather than a hang.
    sendCodeActions(uri: string, range: Range, token?: CancellationToken): Promise<DiagnosticDto[]> {
        if (!this.response_handler.code_actions_supported) {
            return Promise.resolve([]);
        }

        return this.whenAnalysed(() => {
            this.send({
                command: "code_actions",
                path: normalizeFileUri(uri),
                start_line: range.start.line + 1,
                start_column: range.start.character + 1,
                end_line: range.end.line + 1,
                end_column: range.end.character + 1
            });

            return this.response_handler.expectCodeActions();
        }, [], token);
    }

    sendHover(uri: string, line: number, character: number, token?: CancellationToken): Promise<Hover> {
        return this.whenAnalysed(() => {
            this.send({
                command: "hover",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectHover();
        }, null, token);
    }

    sendDefinition(uri: string, line: number, character: number, token?: CancellationToken): Promise<Definition> {
        return this.whenAnalysed(() => {
            this.send({
                command: "definition",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectDefinition();
        }, null, token);
    }

    sendDeclaration(uri: string, line: number, character: number, token?: CancellationToken): Promise<Definition> {
        return this.whenAnalysed(() => {
            this.send({
                command: "declaration",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectDeclaration();
        }, null, token);
    }

    sendCompletion(uri: string, line: number, character: number, token?: CancellationToken): Promise<CompletionItem[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "complete",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectCompletion();
        }, null, token);
    }

    sendSignature(uri: string, line: number, character: number, token?: CancellationToken): Promise<SignatureHelp> {
        return this.whenAnalysed(() => {
            this.send({
                command: "signature",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectSignature();
        }, null, token);
    }

    sendDocumentSymbol(uri: string, token?: CancellationToken): Promise<SymbolInformation[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "symbols",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectSymbols();
        }, null, token);
    }

    sendWorkspaceSymbol(token?: CancellationToken): Promise<SymbolInformation[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "symbols",
                path: ""
            });

            return this.response_handler.expectSymbols();
        }, null, token);
    }

    sendReferences(uri: string, line: number, character: number, token?: CancellationToken): Promise<Location[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "references",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectReferences();
        }, null, token);
    }

    sendImplementation(uri: string, line: number, character: number, token?: CancellationToken): Promise<Location[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "implementation",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectImplementation();
        }, null, token);
    }

    sendTypeDefinition(uri: string, line: number, character: number, token?: CancellationToken): Promise<Definition> {
        return this.whenAnalysed(() => {
            this.send({
                command: "type_definition",
                path: normalizeFileUri(uri),
                line: line + 1,
                column: character + 1
            });

            return this.response_handler.expectTypeDefinition();
        }, null, token);
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

    sendSemanticTokens(uri: string, token?: CancellationToken): Promise<SemanticTokens> {
        return this.whenAnalysed(() => {
            this.send({
                command: "semantic_tokens",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectSemanticTokens();
        }, null, token);
    }

    sendInlayHints(uri: string, token?: CancellationToken): Promise<InlayHint[]> {
        return this.whenAnalysed(() => {
            this.send({
                command: "inlay_hints",
                path: normalizeFileUri(uri)
            });

            return this.response_handler.expectInlayHints();
        }, [], token);
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

    // Ask the analyser for its work counters. Cheap — it walks a map and
    // writes what it finds — and nothing waits on the answer, so this is sent
    // after a compile has already completed rather than on the latency path of
    // one. Deliberately does not start the watchdog: a request this trivial
    // going unanswered says nothing about the analyser's health that the
    // compile before it has not already said.
    sendStatsRequest() {
        this.send({ command: "stats" });
    }

    sendRestart() {
        if (this.analysed) {
            this.watchdog.startWatchdogIfNotRunning();

            this.send({ command: "restart" });
        }
    }
}
