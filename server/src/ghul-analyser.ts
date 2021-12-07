import {
	readFileSync
} from 'fs';

import fileUrl = require('file-url');

import fileUriToPath = require('file-uri-to-path');

import glob = require('glob');

import { GhulConfig } from './ghul-config'; 

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerEventEmitter } from './server-event-emitter';
import { EditQueue } from './edit-queue';

export class GhulAnalyser {
    server_event_emitter: ServerEventEmitter;

    workspace_root: string;
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
    
        console.log("analyse project, config.source is: " + config.source);
        
        config.source.forEach(pattern => {
            console.log("search for files matching glob: " + pattern);

            sourceFiles
                .push(
                    ...glob.sync(pattern)
                        .filter(f => f.endsWith('.ghul'))
                        .map(f => fileUrl(f))
                );
        });
    
        sourceFiles.forEach((file: string) => {
            console.log("queue source file: " + file);
            let path = fileUriToPath(file);

            this.edit_queue.queueEdit3(file, null, '' + readFileSync(path));
        });

        this.edit_queue.startAndSendQueued();;
    }
}
