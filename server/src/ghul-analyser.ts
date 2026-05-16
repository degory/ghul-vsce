import {
	readFileSync
} from 'fs';

import { URL, pathToFileURL, fileURLToPath } from 'url';

import { globSync } from 'glob';

import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { GhulConfig } from './ghul-config';

import { ConfigEventEmitter } from './config-event-emitter';

import { ServerEventEmitter } from './server-event-emitter';
import { EditQueue } from './edit-queue';
import { normalizeFileUri } from './normalize-file-uri';

export class GhulAnalyser {
    server_event_emitter: ServerEventEmitter;

    workspace_root: string;
    edit_queue: EditQueue;
    ghul_config: GhulConfig;
    documents: TextDocuments<TextDocument>;

    constructor(
        edit_queue: EditQueue,

        config_event_emitter: ConfigEventEmitter,
        server_event_emitter: ServerEventEmitter,
        documents: TextDocuments<TextDocument>
    ) {
        this.edit_queue = edit_queue;
        this.documents = documents;

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
                    ...globSync(pattern)
                        .filter(f => f.endsWith('.ghul'))
                        .map(f => pathToFileURL(f))
                );
        });

        // An open editor buffer can hold edits the user has not saved. Prefer
        // it over the file on disk so the analyser — on first analyse and on
        // every recycle — sees what the user is actually looking at.
        let open_source_by_uri = new Map<string, string>();

        for (let document of this.documents.all()) {
            open_source_by_uri.set(normalizeFileUri(document.uri), document.getText());
        }

        let documents = sourceFiles.map((uri: URL) => {
            let mapped = uri.toString();

            let open_source = open_source_by_uri.get(normalizeFileUri(mapped));

            let source = open_source !== undefined
                ? open_source
                : readFileSync(fileURLToPath(uri)).toString();

            return {
                uri: mapped,
                source
            }
        });

        this.edit_queue.start(documents);
    }
}
