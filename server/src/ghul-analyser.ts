
import {
	readFileSync //, Stats
} from 'fs';

import fileUrl = require('file-url');

import fileUriToPath = require('file-uri-to-path');

import readdir = require('recursive-readdir');

import path = require('path');

import { GhulConfig } from './ghul-config'; 

import { Requester } from './requester';

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerEventEmitter } from './server-event-emitter';

export class GhulAnalyser {
    server_event_emitter: ServerEventEmitter;

    workspace_root: string;
    requester: Requester;
    ghul_config: GhulConfig;

    constructor(
        requester: Requester,

        config_event_emitter: ConfigEventEmitter,
        server_event_emitter: ServerEventEmitter
    ) {
        this.requester = requester;

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

        console.log("anaylse whole workspace: " + this.workspace_root);
        
        let sourceFiles = <string[]>[];
    
        let directories = config.ghul_source;
        
        if (this.ghul_config.ghul_lib) {
            console.log("ghul library is in " + config.ghul_lib);
            directories.push(path.resolve(config.ghul_lib));
        }
        
        let promises: Promise<String[]>[] = [];
    
        console.log("read source files from directories: " + JSON.stringify(directories));
    
        for (let i in directories) {
            promises.push(
                readdir(directories[i])
            );
        }
    
        console.log("awaiting read-dir results...");
    
        Promise.all(promises).then(
            (value: string[][]) => {
                console.log("read-dir promises all resolved");
    
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
    
                console.log("source files is: " + JSON.stringify(sourceFiles));
    
                sourceFiles.forEach((file: string) => {
                    console.log("validate source file: " + file);
                    let path = fileUriToPath(file);
    
                    this.requester.sendDocument(file, '' + readFileSync(path));
                });
    
                console.log("all source files queued for parse.");
    
                this.requester.analyse();
    
                console.log("analyse queued.");

                this.server_event_emitter.analysed();
            }
        );
    }
}
