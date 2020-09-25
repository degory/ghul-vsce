
import {
	readFileSync //, Stats
} from 'fs';

// import { log } from './server';

import fileUrl = require('file-url');

import fileUriToPath = require('file-uri-to-path');

import readdir = require('recursive-readdir');

// import path = require('path');

import { GhulConfig } from './ghul-config'; 

// import { Requester } from './requester';

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerEventEmitter } from './server-event-emitter';
import { EditQueue } from './edit-queue';

export class GhulAnalyser {
    server_event_emitter: ServerEventEmitter;

    workspace_root: string;
    // requester: Requester;
    edit_queue: EditQueue;
    ghul_config: GhulConfig;

    constructor(
        edit_queue: EditQueue,

        config_event_emitter: ConfigEventEmitter,
        server_event_emitter: ServerEventEmitter
    ) {
        this.edit_queue = edit_queue;

        this.server_event_emitter = server_event_emitter;

        config_event_emitter.onConfigAvailable((workspace: string, config: GhulConfig) => {
            this.workspace_root = workspace;
            this.ghul_config = config;
        });

        server_event_emitter.onListening(() => {
            this.analyseEntireProject();
        });
    }

    analyseEntireProject() {
        let config = this.ghul_config;

        let sourceFiles = <string[]>[];
    
        let directories = config.source;
               
        let promises: Promise<String[]>[] = [];
        
        for (let i in directories) {
            promises.push(
                readdir(directories[i])
            );
        }
    
        Promise.all(promises).then(
            (value: string[][]) => {    
                for (let i in value) {
                    let results = value[i];
    
                    for (let j in results) {
                        let result = results[j];
    
                        if (result.endsWith('.ghul')) {
                            result = fileUrl(result);
    
                            sourceFiles.push(result);
                        }
                    }
                }
        
                sourceFiles.forEach((file: string) => {
                    let path = fileUriToPath(file);

                    this.edit_queue.queueEdit3(file, null, '' + readFileSync(path));
                });
    
                this.edit_queue.startAndSendQueued();;
    
                // this.server_event_emitter.analysed();
            }
        );
    }
}
