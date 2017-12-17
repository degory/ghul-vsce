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
    timeout: number;
    timer: NodeJS.Timer;

    pending_changes: Map<string,Document>;
    requester: Requester;
    problems: ProblemStore;

    pending_compile_count: number;

    send_start_time: number;
    analyse_start_time: number;

    // state: QueueState;

    _state: QueueState;

    get state(): QueueState {
        log("current edit queue state: " + QueueState[this._state]);
        return this._state;
    }

    set state(value: QueueState) {
        this._state = value;
        log("enter edit queue state: " + QueueState[this._state]);
    }
    
    constructor(
        requester: Requester,
        problems: ProblemStore
    ) {
        this.timeout = 250;
        this.requester = requester;
        this.problems = problems;

        this.pending_changes = new Map();

        this.pending_compile_count = 0;

        this.state = QueueState.START;
    }

    restart() {
        if (this.state == QueueState.IDLE) {
            this.requester.sendRestart();

            this.state = QueueState.START;
        }        
    }

    queueEdit(change: TextDocumentChangeEvent) {
        this.queueEdit3(change.document.uri, change.document.version, change.document.getText());
    }

    queueEdit3(uri: string, version: number, text: string) {
        if (version == null || version < 0) {
            log("queue edit: forced " + uri);
            version = -1;
        } else if (this.pending_changes.has(uri)) {
            let existing = this.pending_changes.get(uri);

            if (existing.version == version &&
                existing.text == text) {
                log("queue edit: ignore redundant edit: version " + version + " of " + uri);
                
                return;
            }

            log("queue edit: version " + version + " of " + uri + " replaces version " + version);            
        } else {
            log("queue edit: previously unseen version " + version + " of " + uri);
        }        

        this.pending_changes.set(uri,
            {
                uri: uri,
                version: version,
                text: text,
                is_pending: true
            });

        if (this.state == QueueState.START) {
            log("queue edit: starting up");
        } else if (this.state == QueueState.IDLE) {
            log("queue edit: idle, will wait for more edits");
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.startTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("queue edit: will continue to wait for more edits");

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
        this.timer = setTimeout(() => { this.onTimeout() }, this.timeout * 0.75);
    }

    buildFinished() {
        let build_time: number = 0;

        if (this.analyse_start_time) {
            build_time = Date.now() - this.analyse_start_time;
            this.timeout = 0.75 * this.timeout + 0.25 * build_time;

            log("edit timeout adjusted to: " + this.timeout + " milliseconds");            
        }

        this.pending_compile_count = this.pending_compile_count - 1;

        if (this.pending_compile_count < 0) {
            log("oops: pending compile count went negative");
            this.pending_compile_count = 0;
        }

        if (this.state == QueueState.WAITING_FOR_BUILD) {
            if (this.pending_compile_count <= 0) {
                log("build finished in " + build_time + " milliseconds: more changes queued, will start another build");

                this.state = QueueState.IDLE;

                this.sendQueued();
            } else {
                log("build finished in " + build_time + " milliseconds: more changes queued, but " + this.pending_compile_count + " builds still in queue, will continue to wait");
            }
        } else if (this.state == QueueState.BUILDING) {
            if (this.pending_compile_count <= 0) {
                log("build finished in " + build_time + " milliseconds: queue is now idle");            
            
                this.state = QueueState.IDLE;
            } else {
                log("build finished in " + build_time + " milliseconds: " + this.pending_compile_count + " builds still in queue, will continue to wait");                
            }
        } else {
            log("build finished: unexpected queue state: " + QueueState[this.state]);

            if (this.pending_compile_count <= 0) {
                this.state = QueueState.IDLE;
            }
        }
    }

    startAndSendQueued() {
        if (this.state == QueueState.START) {
            this.state = QueueState.IDLE;

            this.sendQueued();
        } else {
            log("start and send queued: unexpected queue state: " + QueueState[this.state]);            
        }
    }

    trySendQueued() {
        if (
            this.state == QueueState.IDLE ||
            this.state == QueueState.WAITING_FOR_MORE_EDITS
        ) {
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
                let to_analyse: string[] = [];

                for (let change of this.pending_changes.values()) {
                    if (change.is_pending) {
                        seen_any = true;
        
                        this.problems.clear_parse_problems(change.uri);
                        log("send queued: version " + change.version + " of " + change.uri);
                        this.requester.sendDocument(change.uri, change.text);
        
                        to_analyse.push(change.uri);
        
                        change.is_pending = false;
                    }
                }        

                if (this.state == QueueState.BUILDING) {
                    rejectAllAndThrow("try send queued: compiler is building and did not expect to find changes: " + QueueState[this.state]);

                } else if (this.state == QueueState.WAITING_FOR_BUILD) {
                    log("try send queued: forced to send edits while a build is already running");

                    this.state = QueueState.BUILDING;
                    
                    this.problems.clear_all_analysis_problems();

                    this.pending_compile_count = this.pending_compile_count + 1;

                    this.analyse_start_time = Date.now();                    
                    
                    this.requester.analyse(to_analyse);
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

        this.send_start_time = Date.now();

        let to_analyse: string[] = [];

        for (let change of this.pending_changes.values()) {
            if (change.is_pending) {
                seen_any = true;

                this.problems.clear_parse_problems(change.uri);
                log("send queued: version " + change.version + " of " + change.uri);
                this.requester.sendDocument(change.uri, change.text);

                to_analyse.push(change.uri);

                change.is_pending = false;
            }
        }

        if (seen_any) {
            this.state = QueueState.BUILDING;

            this.problems.clear_all_analysis_problems();

            let time_to_send = this.send_start_time - Date.now();

            log("edit queue: changed documents sent in " + time_to_send + " milliseconds");
            
            this.analyse_start_time = Date.now();

            this.pending_compile_count = this.pending_compile_count + 1;

            this.requester.analyse(to_analyse);
        } else {
            this.state = QueueState.IDLE;
        }
    }
}