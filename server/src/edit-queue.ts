import { TextDocumentChangeEvent } from 'vscode-languageserver'

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
        console.log("queue edit...");

        if (this.pending_changes.has(change.document.uri)) 
        {
            let existing = this.pending_changes.get(change.document.uri);

            if (existing.version == change.document.version &&
                existing.text == change.document.getText()) {
                console.log("ignore redundant edit " + change.document.version + " for " + change.document.uri);
                
                return;
            } else {
                console.log("updated version of " + change.document.uri);
            }
        } else {
            console.log("no existing change for: " + change.document.uri + " in: ");
            console.log(JSON.stringify(this.pending_changes));
        }

        console.log("queue edit " + change.document.uri);
        
        this.pending_changes.set(change.document.uri,
            {
                uri: change.document.uri,
                version: change.document.version,
                text: change.document.getText(),
                is_pending: true
            });

        if (this.state == QueueState.IDLE) {
            console.log("queue idle, starting timer");
            this.state = QueueState.WAITING_FOR_MORE_EDITS;
            
            this.startTimer();
        } else if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            console.log("waiting for more edits, resetting timer: " + QueueState[this.state]);

            this.resetTimer();            
        } else if (this.state == QueueState.BUILDING || this.state == QueueState.WAITING_FOR_BUILD) {
            console.log("queue not idle, enter waiting state");
            
            this.state = QueueState.WAITING_FOR_BUILD;
        } else {
            throw "Unexpected queue state in queueEdit: " + QueueState[this.state];            
        }
    }

    onTimeout() {
        console.log("on timeout: " + QueueState[this.state] + " (" + this.state + ")");
        if (this.state == QueueState.WAITING_FOR_MORE_EDITS) {
            console.log("was waiting for edits, will send queued...");            

            this.sendQueued();
        } else if (this.state == QueueState.WAITING_FOR_BUILD) {
            console.log("was waiting for build, will reset timer...");            
        
            this.resetTimer();
        } else {
            console.log("not waiting for edits: " + QueueState[this.state] + " (" + this.state + ")");
        }
    }

    resetTimer() {
        console.log("reset timer...");            
        
        clearTimeout(this.timer);
        this.startTimer();
    }

    startTimer() {
        console.log("start timer...");            
        
        this.timer = setTimeout(() => { this.onTimeout() }, 500);
    }

    buildFinished() {
        if (this.state == QueueState.WAITING_FOR_BUILD) {
            console.log("build finished but changes queued: queuing another build");            

            this.state = QueueState.IDLE;

            this.sendQueued();
        } else if (this.state == QueueState.BUILDING) {
            console.log("build finished: entering idle state");            
            
            this.state = QueueState.IDLE;
        } else {
            throw "Unexpected queue state in buildFinished: " + QueueState[this.state];
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
                    console.log("not ideal: sending edits while build is already running: " + QueueState[this.state]);

                    this.state = QueueState.BUILDING;
                    
                    this.problems.clear_all_analysis_problems();
                    
                    this.requester.analyse();
                    
                    console.log("queued edits sent");                    
                } else {
                    console.trace("Unexpected queue state in trySendQueued: " + QueueState[this.state]);
                    throw "Unexpected queue state in trySendQueued: " + QueueState[this.state];                            
                }
            }
        }
    }

    sendQueued() {
        console.log("send queued...");

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
                console.log("send queued: " + change.uri);
                this.requester.sendDocument(change.uri, change.text);

                change.is_pending = false;
            }
        }

        if (seen_any) {
            this.state = QueueState.BUILDING;

            this.problems.clear_all_analysis_problems();
            
            this.requester.analyse();
            
            console.log("queued edits sent");

        } else {
            console.log("no queued edits found");
            this.state = QueueState.IDLE;
        }
    }
}