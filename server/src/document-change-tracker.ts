import { readFileSync } from "fs";
import * as minimatch from "minimatch";
import { DidOpenTextDocumentParams, DidChangeWatchedFilesParams, FileChangeType, TextDocumentChangeEvent } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { normalizeFileUri } from "./normalize-file-uri";
import { EditQueue } from "./edit-queue";
import { TextDocument } from "vscode-languageserver-textdocument";

import { reinitialize } from './server'

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

    onDidOpen(event: TextDocumentChangeEvent<TextDocument>) {
        if (!this.tryGetValidSourceFile(event.document.uri)) {
            return;
        }

        let uri = normalizeFileUri(event.document.uri);

        this.edit_queue.queueEdit3(uri, null, event.document.getText());

        this.open_documents.add(uri);
    }

    onDidClose(event: TextDocumentChangeEvent<TextDocument>) {
        let uri = normalizeFileUri(event.document.uri);

        this.open_documents.delete(uri);
    }

    onDidOpenTextDocument(params: DidOpenTextDocumentParams) {
        console.log("QQQQQQ: >>>> open document: " + params.textDocument.uri + " language ID: " + params.textDocument.languageId);

        if (!this.tryGetValidSourceFile(params.textDocument.uri)) {
            return;
        }

        let uri = normalizeFileUri(params.textDocument.uri);

        this.edit_queue.queueEdit3(uri, null, params.textDocument.text);

        this.open_documents.add(uri);
    }

    onDidCloseTextDocument(params: DidOpenTextDocumentParams) {
        console.log("QQQQQQ: <<<< close document: " + params.textDocument.uri + " language ID: " + params.textDocument.languageId);

        if (!this.tryGetValidSourceFile(params.textDocument.uri)) {
            return;
        }

        let uri = normalizeFileUri(params.textDocument.uri);

        this.open_documents.delete(uri);
    }

    onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        if (!params?.changes) {
            return;
        }

        for (let c of params.changes) {
            if (
                c.uri.endsWith(".ghulproj") ||
                c.uri.endsWith("Directory.Build.props") ||
                c.uri.endsWith("dotnet-tools.json")
            ) {
                console.log("project file changed: " + c.uri);

                reinitialize();

                return;
            }

            let fn = this.tryGetValidSourceFile(c.uri);
            
            if (!fn) {
                continue;
            }

            let uri = normalizeFileUri(c.uri);
 
            if (this.isOpen(uri)) {
                continue;
            }

            if (c.type == FileChangeType.Changed || c.type == FileChangeType.Created) {
                this.edit_queue.queueEdit3(uri, null, readFileSync(fn).toString());
            } else if (c.type == FileChangeType.Deleted) {
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