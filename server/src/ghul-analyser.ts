import {
	readFileSync
} from 'fs';

import { URL, pathToFileURL, fileURLToPath } from 'url';

import glob = require('glob');

import { GhulConfig } from './ghul-config'; 

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerEventEmitter } from './server-event-emitter';
import { EditQueue } from './edit-queue';
import { log } from 'console';

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
        log('GhulAnalyser constructor');

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

        let sourceFiles = <URL[]>[];    
       
        config.source.forEach(pattern => {
            sourceFiles
                .push(
                    ...glob.sync(pattern)
                        .filter(f => f.endsWith('.ghul'))
                        .map(f => pathToFileURL(f))
                );
        });

        let documents = sourceFiles.map((uri: URL) => {
            let path = fileURLToPath(uri);
            let source =  readFileSync(path).toString();

            let mapped = uri.toString();

            return {
                uri: mapped,
                source
            }
        });

        this.edit_queue.start(documents);
    }
}
