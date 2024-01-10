import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { log, rejectAllAndThrow } from './server';

import { Requester } from './requester'

import { ProblemStore } from './problem-store'
import { clearTimeout } from 'timers';
import { normalizeFileUri } from './normalize-file-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

enum QueueState {
    START,
    IDLE,
    WAITING_FOR_MORE_EDITS,
    SENDING,
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
    problems: ProblemStore;

    send_start_time: number;
    analyse_start_time: number;

    state: QueueState;
    
    constructor(
        requester: Requester,
        problems: ProblemStore
    ) {
        this.build_count = 0;
        this.fake_version = -1;

        this.requester = requester;
        this.problems = problems;

        this.pending_changes = new Map();

        this.state = QueueState.START;
    }

    reset() {
        // log("edit queue: clear");
        this.problems.clear();
        this.pending_changes.clear();

        this.state = QueueState.IDLE;
    }

    queueEdit(change: TextDocumentChangeEvent<TextDocument>) {
        // log("edit queue: queue change: ", change.document.uri, change.document.version);
        this.queueEdit3(normalizeFileUri(change.document.uri), change.document.version, change.document.getText());
    }

    sendMultiEdits(documents: { uri: string, source: string}[]) {
        this.state = QueueState.SENDING;

        // log("edit queue: send multi edits: ", documents.map(doc => doc.uri));

        this.requester.sendDocuments(documents);

        this.state = QueueState.IDLE;
    }

    queueEdit3(uri: string, version: number, text: string) {
        // log("edit queue: queue edit 3: ", uri, version);

        if (version == null || version < 0) {
            // log("edit queue: fake version: " + uri);

            version = this.fake_version--;
        } else if (this.pending_changes.has(uri)) {
            // log("edit queue: already have pending changes for: " + uri);

            let existing = this.pending_changes.get(uri);

            // Visual Studio Code seems to needlessly resend the same edits occasionally: 
            if (existing.version == version &&
                existing.text == text) {
                // log("edit queue: ignore same version edit: " + uri);

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
            // log("edit queue: queue edit 3: in start state, do nothing: ", uri, version);
        } else if (this.state == QueueState.IDLE) {
            // log("edit queue: queue edit 3: in idle state, wait for more edits: ", uri, version);

            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.startEditTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            // log("edit queue: queue edit 3: already waiting for more edits, reset timer: ", uri, version);

            this.resetEditTimer();
        } else {
            // log("edit queue: queue edit 3: unexpected state, reject promise: ", uri, version);

            rejectAllAndThrow("queue edit: unexpected queue state (A): " + QueueState[this.state]);
        }
    }

    onEditTimeout() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("edit queue: on edit timeout: will send queued edits");

            this.sendQueued();
        } else {
            log("timer expired but not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    resetEditTimer() {
        log("edit queue: reset edit timeout");

        clearTimeout(this.edit_timer);
        this.startEditTimer();
    }

    startEditTimer() {
        this.edit_timer = setTimeout(() => { this.onEditTimeout() }, 500);
    }

    start(documents: { uri: string, source: string}[]) {
        this.sendMultiEdits(documents);
    }

    sendQueued() {
        log("edit queue: send queued");

        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            clearTimeout(this.edit_timer);
        } else if (this.state != QueueState.IDLE) {
            rejectAllAndThrow("send queued: unexpected queue state (E): " + QueueState[this.state]);
        }

        this.send_start_time = Date.now();
        
        this.problems.clear_all_analysis_problems();

        let documents = <{ uri: string, source: string}[]>[]

        for (let change of this.pending_changes.values()) {            
            if (change.is_pending) {
                log("edit queue: send queued: will send: ", change.uri, change.version);

                this.problems.clear_parse_problems(change.uri);

                documents.push({uri: change.uri, source: change.text});

                change.is_pending = false;
            } else {
                log("edit queue: send queued: ignore non pending: ", change.uri, change.version);
            }
        }

        this.sendMultiEdits(documents);
    }
}