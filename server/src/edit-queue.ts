import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { log } from './log';

import { rejectAllAndThrow } from './extension-state';

import { Requester } from './requester'

import { clearTimeout } from 'timers';
import { normalizeFileUri } from './normalize-file-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

enum QueueState {
    START,
    IDLE,
    WAITING_FOR_MORE_EDITS,
    DOING_PARTIAL_COMPILE,
    WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE,
    DOING_FULL_COMPILE,
}

interface Document {
    uri: string,
    version: number,
    text: string,
    is_pending: boolean 
}

export class EditQueue {
    fake_version: number;

    expected_build_time: number;

    // edit_timeout: number;
    edit_timer: NodeJS.Timer;

    build_count: number;

    full_build_timeout: number;
    full_build_timer: NodeJS.Timer;

    pending_changes: Map<string,Document>;
    requester: Requester;

    send_start_time: number;
    analyse_start_time: number;

    state: QueueState;

    static readonly FULL_BUILD_EDIT_TIMEOUT = 1000;
    static readonly PARTIAL_BUILD_EDIT_TIMEOUT = 300;
    
    constructor(
        requester: Requester
    ) {
        log("edit queue: constructor");

        this.build_count = 0;
        this.fake_version = -1;

        this.requester = requester;

        this.pending_changes = new Map();

        this.state = QueueState.START;
    }

    reset() {
        this.pending_changes.clear();

        this.state = QueueState.IDLE;
    }

    queueEdit(change: TextDocumentChangeEvent<TextDocument>) {
        this.queueEdit3(normalizeFileUri(change.document.uri), change.document.version, change.document.getText());
    }

    sendMultiEdits(documents: { uri: string, source: string}[]) {
        if (this.state == QueueState.START) {
            // do nothing
        } else if (this.state == QueueState.IDLE || this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.state = QueueState.DOING_PARTIAL_COMPILE;
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE) { 
            this.state = QueueState.DOING_PARTIAL_COMPILE;
        } else {
            rejectAllAndThrow("send multi edits: unexpected queue state (B): " + QueueState[this.state]);
        }

        this.requester.sendDocuments(documents);
    }

    queueEdit3(uri: string, version: number, text: string) {
        if (version == null || version < 0) {
            version = this.fake_version--;
        } else if (this.pending_changes.has(uri)) {
            let existing = this.pending_changes.get(uri);

            // Visual Studio Code seems to needlessly resend the same edits occasionally: 
            if (existing.version == version &&
                existing.text == text) {

                return;
            }
        }

        this.pending_changes.set(uri,
            {
                uri: uri,
                version: version,
                text: text,
                is_pending: true
            });

        if (this.state == QueueState.START) {
            // do nothing
        } else if (this.state == QueueState.IDLE) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.startEditTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.resetEditTimer();
        } else if (this.state == QueueState.DOING_PARTIAL_COMPILE) {
            // do nothing, wait for partial compiler to complete
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.resetEditTimer();
        } else if (this.state == QueueState.DOING_FULL_COMPILE) {
            // do nothing, wait for full compiler to complete
        } else {
            rejectAllAndThrow("queue edit: unexpected queue state (A): " + QueueState[this.state]);
        }
    }

    onEditTimeout() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.sendQueued("edit timeout when waiting for more edits");
        } else if(this.state == QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE) {
            if (this.wouldSendAny()) {
                this.sendQueued("edit timeout when waiting for more edits after partial compile");
            } else {
                this.requestFullCompile();
            }
        } else {
            log("timer expired but not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    onDiagnosticsReceived() {
        if (this.state == QueueState.START) {
            this.state = QueueState.IDLE;
        }
    }

    onPartialCompileDone() {
        if (this.state == QueueState.DOING_PARTIAL_COMPILE) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE;

            this.startEditTimer(EditQueue.FULL_BUILD_EDIT_TIMEOUT);
        } else {
            log("edit queue: on partial compile done: unexpected queue state (C): " + QueueState[this.state] + " (" + this.state + ")");

            // rejectAllAndThrow("partial compile done: unexpected queue state (C): " + QueueState[this.state]);
        }
    }

    onFullCompileDone() {
        if (this.state == QueueState.DOING_FULL_COMPILE) {
            this.state = QueueState.IDLE;
        } else {
            rejectAllAndThrow("full compile done: unexpected queue state (D): " + QueueState[this.state]);
        }
    }

    private requestFullCompile() {
        this.requester.sendFullCompileRequest();

        this.state = QueueState.DOING_FULL_COMPILE;
    }

    resetEditTimer(timeout: number = EditQueue.FULL_BUILD_EDIT_TIMEOUT) {
        clearTimeout(this.edit_timer);
        this.startEditTimer(timeout);
    }

    startEditTimer(timeout: number = EditQueue.PARTIAL_BUILD_EDIT_TIMEOUT) {
        this.edit_timer = setTimeout(() => { this.onEditTimeout() }, timeout);
    }

    start(documents: { uri: string, source: string}[]) {
        this.sendMultiEdits(documents);
    }

    wouldSendAny() {
        return [...this.pending_changes.values()].some(change => change.is_pending);
    }

    sendQueued(_why: string = "send queued") {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS || this.state == QueueState.WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE) {
            clearTimeout(this.edit_timer);
        } else if (this.state == QueueState.DOING_PARTIAL_COMPILE || this.state == QueueState.DOING_FULL_COMPILE) {
            this.state = QueueState.IDLE;
        } else if (this.state != QueueState.IDLE) {
            rejectAllAndThrow("send queued: unexpected queue state (E): " + QueueState[this.state]);
        }

        this.send_start_time = Date.now();
        
        let documents = <{ uri: string, source: string}[]>[];

        for (let change of this.pending_changes.values()) {            
            if (change.is_pending) {
                documents.push({uri: change.uri, source: change.text});

                change.is_pending = false;
            } else {
                // ignore non-pending changes
            }
        }

        this.sendMultiEdits(documents);
    }
}