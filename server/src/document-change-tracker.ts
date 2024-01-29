import { readFileSync } from "fs";
import { DidChangeWatchedFilesParams, FileChangeType } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { debounce } from "throttle-debounce";

import { normalizeFileUri } from "./normalize-file-uri";
import { EditQueue } from "./edit-queue";

import { reinitialize } from './extension-state'
import { log } from "console";
import { minimatch } from 'minimatch';

const debounced_reinitialize = debounce(5000, () => { reinitialize(); } );


// FIXME: right now this doesn't seem to do anything useful - I don't really
// care if files are opened and closed, I want to know if they're deleted
// or renamed, but I don't seem to get passed that information.

export class DocumentChangeTracker {
    edit_queue: EditQueue;
    globs: string[];

    open_documents: Set<string>;

    constructor(
        edit_queue: EditQueue,
        globs: string[]
    ) {
        this.edit_queue = edit_queue;
        this.globs = globs;
        this.open_documents = new Set<string>();
    }

    isOpen(fn: string) {
        return this.open_documents.has(fn);
    }

    onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        if (!params?.changes) {
            return;
        }

        for (let c of params.changes) {
            // FIXME: check for file name matches, not just
            // uri suffixes:
            if (
                c.uri.endsWith(".ghulproj") ||
                c.uri.endsWith("Directory.Build.props") ||
                c.uri.endsWith("dotnet-tools.json")
            ) {
                log("project file changed: " + c.uri);

                debounced_reinitialize();

                return;
            } else if(c.uri.endsWith(".block")) {
                log("compiler block requested: " + c.uri);

                reinitialize();
            }

            let fn = this.tryGetValidSourceFile(c.uri);
            
            if (!fn) {
                continue;
            }

            let uri = normalizeFileUri(c.uri);

            log("valid source file changed: " + uri);

            if(c.type == FileChangeType.Changed || c.type == FileChangeType.Created) {
                log("changed or created");
                this.edit_queue.queueEdit3(uri, null, readFileSync(fn).toString());
            } else if(c.type == FileChangeType.Deleted && this.isOpen(uri)) {
                log("deleted");
                this.edit_queue.queueEdit3(uri, null, "");
            }
        }
    }

    tryGetValidSourceFile(uri: string) {
        let parsed_uri = URI.parse(uri); 

        if (parsed_uri.scheme != "file") {
            return null;
        }

        let fn = parsed_uri.fsPath;

        log("have file name: ", fn, " attempt to match against globs: ", this.globs);

        if (
            this.globs
                .find(
                    glob => minimatch(fn, glob)
                )
        ) {
            return fn;
        }

        return null;
    }
}