import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { log, rejectAllAndThrow } from './server';

import { Requester } from './requester'

import { ProblemStore } from './problem-store'
import { clearTimeout } from 'timers';

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
    can_build_all: boolean;

    expected_build_time: number;

    edit_timeout: number;
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

        this.full_build_timeout = 10000;

        this.can_build_all = true;
        this.requester = requester;
        this.problems = problems;

        this.pending_changes = new Map();

        this.state = QueueState.START;
    }

    reset() {
        this.problems.clear();
        this.pending_changes.clear();

        this.state = QueueState.IDLE;
        
        this.can_build_all = true;
    }

    queueEdit(change: TextDocumentChangeEvent) {
        this.queueEdit3(change.document.uri, change.document.version, change.document.getText());
    }

    sendMultiEdits(documents: { uri: string, source: string}[]) {
        if (this.state != QueueState.START) {
            rejectAllAndThrow("queue multi edits: unexpected queue state (A): " + QueueState[this.state]);
        }

        this.state = QueueState.SENDING;

        this.requester.sendDocuments(documents);

        this.state = QueueState.IDLE;
    }

    queueEdit3(uri: string, version: number, text: string) {
        if (version == null || version < 0) {
            version = -1;
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
        } else if (this.state == QueueState.IDLE) {
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.startEditTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.resetEditTimer();
        } else {
            rejectAllAndThrow("queue edit: unexpected queue state (A): " + QueueState[this.state]);
        }
    }

    onEditTimeout() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.sendQueued();
        } else {
            log("timer expired: not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    resetEditTimer() {
        clearTimeout(this.edit_timer);
        this.startEditTimer();
    }

    startEditTimer() {
        this.edit_timer = setTimeout(() => { this.onEditTimeout() }, 50);
    }

    start(documents: { uri: string, source: string}[]) {
        this.sendMultiEdits(documents);
    }

    sendQueued() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            clearTimeout(this.edit_timer);
        } else if (this.state != QueueState.IDLE) {
            rejectAllAndThrow("send queued: unexpected queue state (E): " + QueueState[this.state]);
        }

        this.state = QueueState.SENDING;

        this.send_start_time = Date.now();

        this.problems.clear_all_analysis_problems();

        for (let change of this.pending_changes.values()) {
            if (change.is_pending) {
                this.problems.clear_parse_problems(change.uri);
                this.requester.sendDocument(change.uri, change.text);

                change.is_pending = false;
            }
        }

        this.state = QueueState.IDLE;
    }
}