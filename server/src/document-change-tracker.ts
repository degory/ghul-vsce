import { readFileSync } from "fs";
import * as minimatch from "minimatch";
import { DidOpenTextDocumentParams, DidChangeWatchedFilesParams, FileChangeType } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { EditQueue } from "./edit-queue";

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

    onDidOpenTextDocument(params: DidOpenTextDocumentParams) {
        console.log("OOOOOO: >>>> open document: " + params.textDocument.uri + " language ID: " + params.textDocument.languageId);

        this.open_documents.add(params.textDocument.uri);
    }

    onDidCloseTextDocument(params: DidOpenTextDocumentParams) {
        console.log("OOOOOO: <<<< close document: " + params.textDocument.uri + " language ID: " + params.textDocument.languageId);

        this.open_documents.delete(params.textDocument.uri);
    }

    onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        if (!params?.changes) {
            return;
        }

        for (let c of params.changes) {
            let fn = URI.parse(c.uri).fsPath;

            if (this.isOpen(fn)) {
                continue;
            }

            console.log("XXXXXX: on did change: " + c.type + " " + c.uri + " -> " + fn);
            console.log("XXXXXX: globs: " + JSON.stringify(this.globs));

            if (
                !this.globs
                    .find(
                        glob => minimatch(fn, glob)
                    )
            ) {
                console.log("XXXXXX: no glob matches: " + c.type + " " + c.uri);

                continue;
            }

            if (c.type == FileChangeType.Changed || c.type == FileChangeType.Created) {
                console.log("XXXXXX: on did add or change: " + c.type + " " + c.uri);

                this.edit_queue.queueEdit3(c.uri, null, readFileSync(fn).toString());
            } else if (c.type == FileChangeType.Deleted) {
                console.log("XXXXXX: on did delete: " + c.type + " " + c.uri);

                this.edit_queue.queueEdit3(c.uri, null, "");
            }
        }
    }
}