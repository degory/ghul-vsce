import { TextDocumentChangeEvent } from 'vscode-languageserver'

import { Requester } from './requester'

import { ProblemStore } from './problem-store'

enum QueueState {
    IDLE,
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
        } else {
            console.log("queue not idle, enter waiting state");
            
            this.state = QueueState.WAITING;
        }
    }

    buildFinished() {
        if (this.state == QueueState.WAITING) {
            console.log("build finished but changes queued: queuing another build");            

            this.sendQueued();
        } else {
            console.log("build finished: entering idle state");            
            
            this.state = QueueState.IDLE;
        }
    }

    sendQueued() {
        console.log("send queued...");

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
            this.problems.clear_all_analysis_problems();
            
            this.requester.analyse();
            
            console.log("queued edits sent");

            this.state = QueueState.BUILDING;
        } else {
            console.log("no queued edits found");
        }
    }
}