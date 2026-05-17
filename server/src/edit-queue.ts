import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { log } from './log';

import { getWatchdogTimeout, isWatchdogRunning, rejectAllAndThrow, setWatchdogTimeout } from './extension-state';

import { Requester } from './requester'

import { normalizeFileUri } from './normalize-file-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

enum QueueState {
    START,
    IDLE,
    WAITING_FOR_MORE_EDITS,
    DOING_PARTIAL_COMPILE,
    WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE,
    DOING_FULL_COMPILE,
    DOING_HEAP_CHECK,
}

interface Document {
    uri: string,
    version: number,
    text: string 
}

export class EditQueue {
    fake_version: number;

    expected_build_time: number;

    edit_timeout: number;
    edit_timer: NodeJS.Timeout;

    // Long-period timer, armed only in the IDLE state — strictly outside the
    // edit/compile timer's territory, so the two never run at the same time.
    idle_timer: NodeJS.Timeout;

    edit_count: number;
    build_count: number;

    full_build_timeout: number;

    pending_changes: Map<string,Document>;
    requester: Requester;

    send_start_time: number;
    analyse_start_time: number;

    state: QueueState;

    static readonly FULL_BUILD_EDIT_TIMEOUT = 1000;
    static readonly PARTIAL_BUILD_EDIT_TIMEOUT = 100;

    // How long the queue must sit IDLE before asking the analyser to sample
    // the heap — long enough that it is a genuine lull in editing.
    static readonly HEAP_CHECK_IDLE_TIMEOUT = 60000;
    
    constructor(
        requester: Requester
    ) {
        this.edit_count = 0;
        this.build_count = 0;
        this.fake_version = -1;

        this.requester = requester;

        this.pending_changes = new Map();

        this.state = QueueState.START;

        this.edit_timeout = EditQueue.PARTIAL_BUILD_EDIT_TIMEOUT;
        this.full_build_timeout = EditQueue.FULL_BUILD_EDIT_TIMEOUT;
    }

    reset() {
        this.pending_changes.clear();
        this.clearEditTimer();
        this.clearIdleTimer();

        this.state = QueueState.IDLE;
    }

    queueEdit(change: TextDocumentChangeEvent<TextDocument>) {
        this.queueEdit3(normalizeFileUri(change.document.uri), change.document.version, change.document.getText());
    }

    sendMultiEdits(documents: { uri: string, source: string }[]) {
        this.requester.sendDocuments(documents);
    }

    queueEdit3(uri: string, version: number, text: string) {
        if (version == null || version < 0) {
            version = this.fake_version--;
        }

        this.pending_changes.set(uri,
            {
                uri: uri,
                version: version,
                text: text
            });

        if (this.state == QueueState.START) {
            // do nothing
        } else if (this.state == QueueState.IDLE) {
            this.clearIdleTimer();

            this.state = QueueState.WAITING_FOR_MORE_EDITS;

            this.startEditTimer(this.edit_timeout);
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.startEditTimer(this.edit_timeout);
        } else if (this.state == QueueState.DOING_PARTIAL_COMPILE) {
            // do nothing, wait for partial compiler to complete
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS;

            this.startEditTimer(this.edit_timeout);
        } else if (this.state == QueueState.DOING_FULL_COMPILE) {
            // do nothing, wait for full compiler to complete
        } else if (this.state == QueueState.DOING_HEAP_CHECK) {
            // do nothing, wait for the heap check to complete
        } else {
            rejectAllAndThrow("queue edit: unexpected queue state (A): " + QueueState[this.state]);
        }
    }

    onEditTimeout() {
        // The timer has fired; its handle is spent. Drop the reference so a
        // later clearEditTimer cannot act on a stale handle.
        this.edit_timer = null;

        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.sendQueued("edit timeout when waiting for more edits");
        } else if(this.state == QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE) {
            if (this.pending_changes.size > 0) {
                this.sendQueued("edit timeout when waiting for more edits after partial compile");
            } else {
                this.requestFullCompile();
            }
        } else {
            log("timer expired but not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    // The queue has sat IDLE long enough to be a genuine lull, so ask the
    // analyser to sample the heap — its forced GC then lands off the latency
    // path of interactive requests. Query requests (hover, completion, …)
    // bypass this queue, so the queue can be IDLE while a request is still in
    // flight; if anything is outstanding, the heap check is dropped and the
    // idle timer re-armed for the next lull rather than risk overlapping it
    // with another request.
    onIdleTimeout() {
        if (this.state == QueueState.IDLE && !isWatchdogRunning()) {
            this.requester.sendHeapCheckRequest();

            this.state = QueueState.DOING_HEAP_CHECK;
        } else {
            this.startIdleTimer();
        }
    }

    onDiagnosticsReceived() {
        if (this.state == QueueState.START) {
            this.state = QueueState.IDLE;
        }
    }

    onPartialCompileDone(milliseconds: number) {
        if (this.state != QueueState.DOING_PARTIAL_COMPILE) {
            // A stray PARTIAL DONE — e.g. left over from a compiler recycle.
            // Drop it rather than driving a transition (and arming an edit
            // timer) from a state that never requested a partial compile.
            log("edit queue: on partial compile done: unexpected queue state (C): " + QueueState[this.state] + " (" + this.state + ")");
            return;
        }

        if (milliseconds) {
            this.edit_timeout = milliseconds * 1.5;

            if (this.full_build_timeout < this.edit_timeout) {
                this.full_build_timeout = this.edit_timeout;

                setWatchdogTimeout(this.full_build_timeout * 2);
            }

            if ((this.edit_count & 31) == 0) {
                log(`edit request average: ${milliseconds.toFixed()} ms, edit timeout: ${this.edit_timeout.toFixed()} ms, compile timeout: ${this.full_build_timeout.toFixed()} ms, watchdog timeout: ${getWatchdogTimeout().toFixed()} ms`);
            }

            this.edit_count++;
        }

        if (this.pending_changes.size > 0) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            this.startEditTimer(this.edit_timeout);
        } else {
            this.state = QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE;
            this.startEditTimer(this.full_build_timeout);
        }
    }

    onFullCompileDone(milliseconds: number) {
        if (this.state != QueueState.DOING_FULL_COMPILE) {
            // A stray FULL DONE — drop it rather than transitioning from a
            // state that never requested a full compile.
            log("edit queue: on full compile done: unexpected queue state: " + QueueState[this.state]);
            return;
        }

        if (milliseconds) {
            this.full_build_timeout = milliseconds * 1.5;

            if (this.full_build_timeout < this.edit_timeout) {
                this.full_build_timeout = this.edit_timeout;
            }

            setWatchdogTimeout(this.full_build_timeout * 2);

            if ((this.build_count & 31) == 0) {
                log(`compile request average: ${milliseconds.toFixed()} ms, edit timeout: ${this.edit_timeout.toFixed()} ms, compile timeout: ${this.full_build_timeout.toFixed()} ms, watchdog timeout: ${getWatchdogTimeout().toFixed()} ms`);
            }

            this.build_count++;
        }

        if (this.pending_changes.size > 0) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            this.startEditTimer(this.edit_timeout);
        } else {
            this.state = QueueState.IDLE;
            this.startIdleTimer();
        }
    }

    onHeapCheckDone() {
        if (this.state != QueueState.DOING_HEAP_CHECK) {
            // A stray heap-check completion — drop it rather than transitioning
            // from a state that never requested a heap check.
            log("edit queue: on heap check done: unexpected queue state: " + QueueState[this.state]);
            return;
        }

        if (this.pending_changes.size > 0) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            this.startEditTimer(this.edit_timeout);
        } else {
            // Back to IDLE, but the idle timer is deliberately not re-armed:
            // with no edits there are no compiles, so the heap is not growing.
            // The next full compile re-arms it.
            this.state = QueueState.IDLE;
        }
    }

    forceScheduleFullCompile() {
        this.state = QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE;

        this.startEditTimer(EditQueue.FULL_BUILD_EDIT_TIMEOUT);
    }

    private requestFullCompile() {
        this.requester.sendFullCompileRequest();

        this.state = QueueState.DOING_FULL_COMPILE;
    }

    // Self-clearing, so callers never leak a second edit timer: the queue has
    // exactly one edit/compile timer and it belongs to whichever WAITING state
    // armed it. A stale timer that outlived its state would fire onEditTimeout
    // in an unrelated state — the desync the queue's "unexpected state" logs
    // were reporting.
    startEditTimer(timeout: number) {
        this.clearEditTimer();

        this.edit_timer = setTimeout(() => { this.onEditTimeout() }, timeout);
    }

    clearEditTimer() {
        // Unconditional: clearTimeout is a safe no-op on an absent or already-
        // fired handle, and a truthiness guard would skip a live timer whose
        // handle is the falsy 0.
        clearTimeout(this.edit_timer);
        this.edit_timer = null;
    }

    // Self-clearing, so it is safe to call from every IDLE entry point
    // (onFullCompileDone, and onIdleTimeout when it re-arms) without leaking
    // a second timer.
    startIdleTimer() {
        this.clearIdleTimer();

        this.idle_timer = setTimeout(() => { this.onIdleTimeout() }, EditQueue.HEAP_CHECK_IDLE_TIMEOUT);
    }

    clearIdleTimer() {
        if (this.idle_timer) {
            clearTimeout(this.idle_timer);
            this.idle_timer = null;
        }
    }

    start(documents: { uri: string, source: string }[]) {
        this.clearEditTimer();
        this.clearIdleTimer();

        this.state = QueueState.DOING_PARTIAL_COMPILE;
        this.sendMultiEdits(documents);
    }

    // Flush queued edits ahead of a query (completion / signature help) so the
    // analyser sees the current text before answering. Only meaningful while
    // WAITING with edits not yet sent: if a compile or heap check is already in
    // flight the pending edits ride out on its completion, and barging a second
    // #EDIT# in would leave the queue tracking two in-flight requests as one.
    sendQueued(_why: string = "send queued") {
        if (
            this.state != QueueState.WAITING_FOR_MORE_EDITS &&
            this.state != QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE
        ) {
            return;
        }

        this.clearEditTimer();

        this.send_start_time = Date.now();

        let documents = <{ uri: string, source: string}[]>[];

        for (let change of this.pending_changes.values()) {            
            documents.push({uri: change.uri, source: change.text});
        }

        this.pending_changes.clear();

        this.state = QueueState.DOING_PARTIAL_COMPILE;

        this.sendMultiEdits(documents);
    }
}