import { DidChangeWatchedFilesParams, FileChangeType } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { debounce } from "throttle-debounce";

import { normalizeFileUri } from "./normalize-file-uri";
import { EditQueue } from "./edit-queue";

import { reinitialize } from './extension-state'
import { log } from "console";
import { minimatch } from 'minimatch';
import { readFileSync } from "fs";

const debounced_reinitialize = debounce(5000, () => { reinitialize(); } );

export class DocumentChangeTracker {
    edit_queue: EditQueue;
    globs: string[];

    constructor(
        edit_queue: EditQueue,
        globs: string[]
    ) {
        this.edit_queue = edit_queue;
        this.globs = globs;
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
            } else if(c.uri.endsWith(".block-compiler")) {
                log("compiler block requested: " + c.uri);

                reinitialize();
            }

            let fn = this.tryGetValidSourceFile(c.uri);
            
            if (!fn) {
                continue;
            }

            let uri = normalizeFileUri(c.uri);

            if(c.type == FileChangeType.Deleted) {
                log("source file deleted: '", uri, "', clearing in memory");

                this.edit_queue.queueEdit3(uri, null, "");
            } else if(c.type == FileChangeType.Created) {
                log("source file created: '", uri, "', initializing from from file contents");

                let file_contents = readFileSync(fn, "utf8");

                this.edit_queue.queueEdit3(uri, null, file_contents);
            }
        }
    }

    tryGetValidSourceFile(uri: string) {
        let parsed_uri = URI.parse(uri); 

        if (parsed_uri.scheme != "file") {
            return null;
        }

        let fn = parsed_uri.fsPath;

        if (!fn) {
            log("file URI gives null fsPath: " + uri);
            return null;
        }

        // FIXME: is there a better way to do this?
        let fn_munged = fn.replace(/\\/g, "/");

        if (
            this.globs
                .find(
                    glob => minimatch(fn_munged, glob)
                )
        ) {
            return fn;
        }

        return null;
    }
}