import { DidChangeWatchedFilesParams, FileChangeType, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
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
    documents: TextDocuments<TextDocument>;

    constructor(
        edit_queue: EditQueue,
        globs: string[],
        documents: TextDocuments<TextDocument>
    ) {
        this.edit_queue = edit_queue;
        this.globs = globs;
        this.documents = documents;
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
            } else if(c.type == FileChangeType.Created || c.type == FileChangeType.Changed) {
                // A file open in an editor is tracked through textDocument
                // sync; its buffer — not the file on disk — is the source of
                // truth. Re-reading the saved file here could clobber unsaved
                // edits, so leave open files to the sync path and only reload
                // closed files (e.g. those rewritten by a git pull).
                if (this.isOpenInEditor(uri)) {
                    continue;
                }

                log("source file changed on disk: '", uri, "', reloading from file contents");

                let file_contents = readFileSync(fn, "utf8");

                this.edit_queue.queueEdit3(uri, null, file_contents);
            }
        }
    }

    isOpenInEditor(uri: string) {
        for (let document of this.documents.all()) {
            if (normalizeFileUri(document.uri) == uri) {
                return true;
            }
        }

        return false;
    }

    tryGetValidSourceFile(uri: string) {
        let parsed_uri = URI.parse(uri); 

        if (parsed_uri.scheme != "file") {
            return null;
        }

        let fn = parsed_uri.fsPath;

        if (!fn) {
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