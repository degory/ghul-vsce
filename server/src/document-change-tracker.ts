import { readFileSync } from "fs";
import * as minimatch from "minimatch";
import { DidOpenTextDocumentParams, DidChangeWatchedFilesParams, FileChangeType, TextDocumentChangeEvent } from "vscode-languageserver";
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

    onDidOpen(event: TextDocumentChangeEvent) {
        console.log("OOOOOO: >>>> open document: " + event.document.uri  + " language ID: " + event.document.languageId);

        this.open_documents.add(event.document.languageId);
    }

    onDidClose(event: TextDocumentChangeEvent) {
        console.log("OOOOOO: <<<< close document: " + event.document.uri + " language ID: " + event.document.languageId);

        this.open_documents.delete(event.document.uri);
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
            let uri = URI.parse(c.uri); 

            if (uri.scheme != "file") {
                continue;
            }

            let fn = uri.fsPath;

            if (this.isOpen(c.uri)) {
                console.log("ignore change to open file: " + uri);
                continue;
            }

            if (
                !this.globs
                    .find(
                        glob => minimatch(fn, glob)
                    )
            ) {
                continue;
            }

            if (c.type == FileChangeType.Changed || c.type == FileChangeType.Created) {
                console.log("File added or changed: " + c.type + " " + c.uri);

                this.edit_queue.queueEdit3(c.uri, null, readFileSync(fn).toString());
            } else if (c.type == FileChangeType.Deleted) {
                console.log("File deleted: " + c.type + " " + c.uri);

                this.edit_queue.queueEdit3(c.uri, null, "");
            }
        }
    }
}