import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { Requester } from './requester'

import { ProblemStore } from './problem-store'

enum QueueState {
    IDLE,
    SENDING,
    BUILDING,
    WAITING,
}

interface Document {
    uri: string,
    version: number,
    text: string,
    is_pending: boolean 
}

export class EditQueue {
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

        this.state = QueueState.WAITING;
    }

    queueEdit(change: TextDocumentChangeEvent) {
        if (this.pending_changes.has(change.document.uri)) {
            let existing = this.pending_changes.get(change.document.uri);

            if (existing.version == change.document.version) {
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
            console.log("queue idle, send queued");
            
            this.sendQueued();
        } else if (this.state == QueueState.BUILDING || this.state == QueueState.WAITING) {
            console.log("queue not idle, enter waiting state");
            
            this.state = QueueState.WAITING;
        } else {
            throw "Unexpected queue state in queueEdit: " + QueueState[this.state];            
        }
    }

    buildFinished() {
        if (this.state == QueueState.WAITING) {
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
        if (this.state == QueueState.IDLE) {
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
                console.trace("Cannot send queued: compiler is not idle: " + QueueState[this.state]);
                throw "Cannot send queued: compiler is not idle: " + QueueState[this.state];
            }
        }
    }

    sendQueued() {
        console.log("send queued...");

        if (this.state != QueueState.IDLE) {
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