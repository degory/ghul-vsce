import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { log, rejectAllAndThrow } from './server';

import { Requester } from './requester'

import { ProblemStore } from './problem-store'
import { clearTimeout } from 'timers';

enum QueueState {
    IDLE,
    WAITING_FOR_MORE_EDITS,
    SENDING,
    BUILDING,
    WAITING_FOR_BUILD,
}

interface Document {
    uri: string,
    version: number,
    text: string,
    is_pending: boolean 
}

export class EditQueue {
    timer: NodeJS.Timer;

    pending_changes: Map<string,Document>;
    requester: Requester;
    problems: ProblemStore;

    state: QueueState;

    /*
    _state: QueueState;

    get state(): QueueState {
        log("current edit queue state: " + QueueState[this._state]);
        return this._state;
    }

    set state(value: QueueState) {
        this._state = value;
        log("enter edit queue state: " + QueueState[this._state]);
    }
    */
    
    constructor(
        requester: Requester,
        problems: ProblemStore
    ) {
        this.requester = requester;
        this.problems = problems;

        this.pending_changes = new Map();

        this.state = QueueState.WAITING_FOR_BUILD;
    }

    queueEdit(change: TextDocumentChangeEvent) {
        if (this.pending_changes.has(change.document.uri)) 
        {
            let existing = this.pending_changes.get(change.document.uri);

            if (existing.version == change.document.version &&
                existing.text == change.document.getText()) {
                log("queue edit: ignore redundant edit " + change.document.version + " for " + change.document.uri);
                
                return;
            }
        } else {
            log("queue edit: weird: no existing change for: " + change.document.uri + " in: ");
            log(JSON.stringify(this.pending_changes));
        }

        log("queue edit: " + change.document.uri);
        
        this.pending_changes.set(change.document.uri,
            {
                uri: change.document.uri,
                version: change.document.version,
                text: change.document.getText(),
                is_pending: true
            });

        if (this.state == QueueState.IDLE) {
            log("queue edit: idle, waiting for more edits");
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.startTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("queue edit: continue to wait for more edits");

            this.resetTimer();            
        } else if (this.state == QueueState.BUILDING || this.state == QueueState.WAITING_FOR_BUILD) {
            log("queue edit: building, will wait for build to complete");
            
            this.state = QueueState.WAITING_FOR_BUILD;
        } else {
            rejectAllAndThrow("queue edit: unexpected queue state: " + QueueState[this.state]);
        }
    }

    onTimeout() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("timer expired: was waiting for more edits, will send queued edits");

            this.sendQueued();
        } else if (this.state == QueueState.WAITING_FOR_BUILD) {
            log("timer expired: was waiting for build to complete, will reset timer and continue to wait");            
        
            this.resetTimer();
        } else {
            log("timer expired: not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    resetTimer() {
        clearTimeout(this.timer);
        this.startTimer();
    }

    startTimer() {
        this.timer = setTimeout(() => { this.onTimeout() }, 500);
    }

    buildFinished() {
        if (this.state == QueueState.WAITING_FOR_BUILD) {
            log("build finished: more changes queued, start another build");            

            this.state = QueueState.IDLE;

            this.sendQueued();
        } else if (this.state == QueueState.BUILDING) {
            log("build finished: queue is now idle");            
            
            this.state = QueueState.IDLE;
        } else {
            log("build finished: unexpected queue state: " + QueueState[this.state]);

            this.state = QueueState.IDLE;
        }
    }

    trySendQueued() {
        if (this.state == QueueState.IDLE || this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            this.sendQueued();
        } else {
            let seen_any = false;
            
            for (let change of this.pending_changes.values()) {
                if (change.is_pending) {
                    seen_any = true;

                    break;
                }
            }

            if (seen_any) {
                if (this.state == QueueState.BUILDING) {
                    rejectAllAndThrow("try send queued: compiler is building and did not expect to find changes: " + QueueState[this.state]);

                } else if (this.state == QueueState.WAITING_FOR_BUILD) {
                    log("try send queued: forced to send edits while a build is already running");

                    this.state = QueueState.BUILDING;
                    
                    this.problems.clear_all_analysis_problems();
                    
                    this.requester.analyse();
                } else {
                    rejectAllAndThrow("try send queued: unexpected queue state: " + QueueState[this.state]);
                }
            }
        }
    }

    sendQueued() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            clearTimeout(this.timer);
        } else if (this.state != QueueState.IDLE) {
            rejectAllAndThrow("send queued: unexpected queue state: " + QueueState[this.state]);
        }

        this.state = QueueState.SENDING;

        let seen_any = false;

        for (let change of this.pending_changes.values()) {
            if (change.is_pending) {
                seen_any = true;

                this.problems.clear_parse_problems(change.uri);
                log("send queued: " + change.uri);
                this.requester.sendDocument(change.uri, change.text);

                change.is_pending = false;
            }
        }

        if (seen_any) {
            this.state = QueueState.BUILDING;

            this.problems.clear_all_analysis_problems();
            
            this.requester.analyse();
        } else {
            this.state = QueueState.IDLE;
        }
    }
}