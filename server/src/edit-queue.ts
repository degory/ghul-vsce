import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { log, rejectAllAndThrow } from './server';

import { Requester } from './requester'

import { ProblemStore } from './problem-store'
import { clearTimeout } from 'timers';

enum BuildType {
    LIMITED,
    ALL,
    FULL
}

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
    can_build_all: boolean;

    edit_timeout: number;
    edit_timer: NodeJS.Timer;

    full_build_timeout: number;
    full_build_timer: NodeJS.Timer;

    pending_changes: Map<string,Document>;
    requester: Requester;
    problems: ProblemStore;

    pending_builds: BuildType[];

    last_build_type: BuildType;

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
        this.edit_timeout = 250;

        this.full_build_timeout = 5000;

        this.can_build_all = true;
        this.requester = requester;
        this.problems = problems;

        this.pending_changes = new Map();

        this.pending_builds = [];

        this.state = QueueState.START;
    }

    restart() {
        if (this.state == QueueState.IDLE) {
            this.requester.sendRestart();

            this.state = QueueState.START;

            this.can_build_all = true;
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
            
            this.startEditTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("queue edit: will continue to wait for more edits");

            this.resetEditTimer();            
        } else if (this.state == QueueState.BUILDING || this.state == QueueState.WAITING_FOR_BUILD) {
            log("queue edit: building, will wait for build to complete");
            
            this.state = QueueState.WAITING_FOR_BUILD;
        } else {
            rejectAllAndThrow("queue edit: unexpected queue state: " + QueueState[this.state]);
        }
    }

    onEditTimeout() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            log("timer expired: was waiting for more edits, will send queued edits");

            this.sendQueued();
        } else if (this.state == QueueState.WAITING_FOR_BUILD) {
            log("timer expired: was waiting for build to complete, will reset timer and continue to wait");            
        
            this.resetEditTimer();
        } else {
            log("timer expired: not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    resetEditTimer() {
        clearTimeout(this.edit_timer);
        this.startEditTimer();
    }

    startEditTimer() {
        this.edit_timer = setTimeout(() => { this.onEditTimeout() }, this.edit_timeout * 0.75);
    }

    onFullBuildTimeout() {
        this.full_build_timer = null;

        if (this.last_build_type == BuildType.LIMITED && this.state == QueueState.IDLE) {
            this.state = QueueState.BUILDING;
            this.queueAnalyse();
        }
    }

    startOrResetFullBuildTimer() {
        if (this.full_build_timer) {
            clearTimeout(this.full_build_timer);
        }

        this.full_build_timer = setTimeout(() => { this.onFullBuildTimeout() }, this.full_build_timeout);
    }    

    onBuildFinished() {
        let build_time: number = 0;

        this.last_build_type = BuildType.LIMITED;

        if (this.pending_builds.length > 0) {
             this.last_build_type = this.pending_builds.shift();
             log("build " + BuildType[this.last_build_type] + " complete");
        } else {
            log("oops: expected build just finished");
        }

        if (this.analyse_start_time) {
            build_time = Date.now() - this.analyse_start_time;

            if (this.last_build_type != BuildType.FULL) {
                this.edit_timeout = 0.75 * this.edit_timeout + 0.25 * build_time;

                log("edit timeout adjusted to: " + this.edit_timeout + " milliseconds");

                if (build_time > 125 && this.can_build_all) {
                    log("build time exceded 125 milliseconds: disabling full build per edit");
                    this.can_build_all = false;
                }
            }
        }

        if (this.state == QueueState.WAITING_FOR_BUILD) {
            if (this.pending_builds.length == 0) {
                log("build finished in " + build_time + " milliseconds: more changes queued, will start another build");

                this.state = QueueState.IDLE;

                this.sendQueued();
            } else {
                log("build finished in " + build_time + " milliseconds: more changes queued, but " + this.pending_builds.length + " builds still in queue, will continue to wait");
            }
        } else if (this.state == QueueState.BUILDING) {
            if (this.pending_builds.length == 0) {
                log("build finished in " + build_time + " milliseconds: queue is now idle");            
            
                this.state = QueueState.IDLE;
            } else {
                log("build finished in " + build_time + " milliseconds: " + this.pending_builds.length + " builds still in queue, will continue to wait");                
            }
        } else {
            log("build finished: unexpected queue state: " + QueueState[this.state]);

            if (this.pending_builds.length == 0) {
                this.state = QueueState.IDLE;
            }
        }

        if (this.last_build_type == BuildType.LIMITED && this.state == QueueState.IDLE) {
            log("reached idle state after limited build: will queue a full build after delay");
            this.startOrResetFullBuildTimer();
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
                    
                    this.queueAnalyse(to_analyse);
                } else {
                    rejectAllAndThrow("try send queued: unexpected queue state: " + QueueState[this.state]);
                }
            }
        }
    }

    sendQueued() {
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            clearTimeout(this.edit_timer);
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

            let time_to_send = Date.now() - this.send_start_time;

            log("edit queue: changed documents sent in " + time_to_send + " milliseconds");

            this.queueAnalyse(to_analyse);
        } else {
            this.state = QueueState.IDLE;
        }
    }

    private queueAnalyse(to_analyse?: string[]) {
        this.analyse_start_time = Date.now();            

        let build_type: BuildType;
        
        if (to_analyse) {
            build_type = this.can_build_all ? BuildType.ALL : BuildType.LIMITED;
        } else {
            build_type = BuildType.FULL;
        }
        
        if (build_type != BuildType.LIMITED) {
            to_analyse = ["all"];
        } 

        this.problems.clear_all_analysis_problems();
        this.pending_builds.push(build_type);

        this.requester.analyse(to_analyse);
    }
}