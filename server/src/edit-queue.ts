import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { log } from './server';

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

    _state: QueueState;

    get state(): QueueState {
        log("state is: " + QueueState[this._state]);
        return this._state;
    }

    set state(value: QueueState) {
        this._state = value;
        log("state now: " + QueueState[this._state]);
    }
    
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
        log("queue edit...");

        if (this.pending_changes.has(change.document.uri)) 
        {
            let existing = this.pending_changes.get(change.document.uri);

            if (existing.version == change.document.version &&
                existing.text == change.document.getText()) {
                log("ignore redundant edit " + change.document.version + " for " + change.document.uri);
                
                return;
            } else {
                log("updated version of " + change.document.uri);
            }
        } else {
            log("no existing change for: " + change.document.uri + " in: ");
            log(JSON.stringify(this.pending_changes));
        }

        log("queue edit " + change.document.uri);
        
        this.pending_changes.set(change.document.uri,
            {
                uri: change.document.uri,
                version: change.document.version,
                text: change.document.getText(),
                is_pending: true
            });

        if (this.state == QueueState.IDLE) {
            log("queue idle, starting timer");
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.startTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("waiting for more edits, resetting timer: " + QueueState[this.state]);

            this.resetTimer();            
        } else if (this.state == QueueState.BUILDING || this.state == QueueState.WAITING_FOR_BUILD) {
            log("queue not idle, enter waiting state");
            
            this.state = QueueState.WAITING_FOR_BUILD;
        } else {
            throw "Unexpected queue state in queueEdit: " + QueueState[this.state];            
        }
    }

    onTimeout() {
        log("on timeout: " + QueueState[this.state] + " (" + this.state + ")");
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("was waiting for edits, will send queued...");            

            this.sendQueued();
        } else if (this.state == QueueState.WAITING_FOR_BUILD) {
            log("was waiting for build, will reset timer...");            
        
            this.resetTimer();
        } else {
            log("not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    resetTimer() {
        log("reset timer...");            
        
        clearTimeout(this.timer);
        this.startTimer();
    }

    startTimer() {
        log("start timer...");            
        
        this.timer = setTimeout(() => { this.onTimeout() }, 500);
    }

    buildFinished() {
        if (this.state == QueueState.WAITING_FOR_BUILD) {
            log("build finished but changes queued: queuing another build");            

            this.state = QueueState.IDLE;

            this.sendQueued();
        } else if (this.state == QueueState.BUILDING) {
            log("build finished: entering idle state");            
            
            this.state = QueueState.IDLE;
        } else {
            log("Unexpected queue state in buildFinished: " + QueueState[this.state]);

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
                    console.trace("Send queued: compiler is building and did not expect to find changes: " + QueueState[this.state]);
                    throw "Send queued: compiler is building and did not expect to find changes: " + QueueState[this.state];
                } else if (this.state == QueueState.WAITING_FOR_BUILD) {
                    log("not ideal: sending edits while build is already running: " + QueueState[this.state]);

                    this.state = QueueState.BUILDING;
                    
                    this.problems.clear_all_analysis_problems();
                    
                    this.requester.analyse();
                    
                    log("queued edits sent");                    
                } else {
                    console.trace("Unexpected queue state in trySendQueued: " + QueueState[this.state]);
                    throw "Unexpected queue state in trySendQueued: " + QueueState[this.state];                            
                }
            }
        }
    }

    sendQueued() {
        log("send queued...");

        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            clearTimeout(this.timer);
        } else if (this.state != QueueState.IDLE) {
            console.trace("Unexpected queue state in sendQueued: " + QueueState[this.state]);
            throw "Unexpected queue state in sendQueued: " + QueueState[this.state];
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
            
            log("queued edits sent");

        } else {
            log("no queued edits found");
            this.state = QueueState.IDLE;
        }
    }
}