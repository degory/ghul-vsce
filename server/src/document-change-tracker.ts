import { readFileSync } from "fs";
import { DidOpenTextDocumentParams, DidChangeWatchedFilesParams, FileChangeType, TextDocumentChangeEvent, DidCloseTextDocumentParams } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import { debounce } from "throttle-debounce";

import { normalizeFileUri } from "./normalize-file-uri";
import { EditQueue } from "./edit-queue";

import { reinitialize } from './extension-state'
import { log } from "console";
import { minimatch } from 'minimatch';

const debounced_reinitialize = debounce(5000, () => { reinitialize(); } );


// Right now this doesn't seem to do anything useful - I don't really
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

    onDidOpen(event: TextDocumentChangeEvent<TextDocument>) {
        // TODO don't think this is ever called - can probably be removed

        log("XXXXXX: >>>> open document: " + event.document.uri + " language ID: " + event.document.languageId);
        if (!this.tryGetValidSourceFile(event.document.uri)) {
            return;
        }

        let uri = normalizeFileUri(event.document.uri);

        this.edit_queue.queueEdit3(uri, null, event.document.getText());

        this.open_documents.add(uri);
    }

    onDidClose(event: TextDocumentChangeEvent<TextDocument>) {
        // TODO don't think this is ever called - can probably be removed

        log("XXXXXX: <<<< close document: " + event.document.uri);
        let uri = normalizeFileUri(event.document.uri);

        this.open_documents.delete(uri);
    }

    onDidOpenTextDocument(params: DidOpenTextDocumentParams) {
        if (!this.tryGetValidSourceFile(params.textDocument.uri)) {
            log("open text document: not a valid project source file: " + params.textDocument.uri);
            return;
        }

        let uri = normalizeFileUri(params.textDocument.uri);

        this.edit_queue.queueEdit3(uri, null, params.textDocument.text);
        this.open_documents.add(uri);
    }

    onDidCloseTextDocument(params: DidCloseTextDocumentParams) {
        if (!this.tryGetValidSourceFile(params.textDocument.uri)) {
            log("close text document: not a valid project source file: " + params.textDocument.uri);
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
                log("project file changed: " + c.uri);

                debounced_reinitialize();

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