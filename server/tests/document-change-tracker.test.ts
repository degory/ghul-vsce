import { DidChangeWatchedFilesParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams, FileChangeType, TextDocumentChangeEvent } from 'vscode-languageserver';
import { TextDocument } from "vscode-languageserver-textdocument";

import * as fs from 'fs';

import { DocumentChangeTracker } from '../src/document-change-tracker';
import { EditQueue } from '../src/edit-queue';
import { Requester } from '../src/requester';
import { URI } from 'vscode-uri';


jest.mock('../src/edit-queue');
jest.mock('../src/requester');
jest.mock('fs');

function createTextDocumentChangeEvent(uri: string, text: string): TextDocumentChangeEvent<TextDocument> {
    return {
        document: {
            uri,
            languageId: "plaintext",
            version: 1,
            getText: () => text,
            positionAt: (_offset: number) => {
                // Convert offset to position
                return { line: 0, character: 0 };
            },
            offsetAt: (_position: { line: number, character: number }) => {
                // Convert position to offset
                return 0;
            },
            lineCount: 1
        }
    };        
}

// function getValidWorkspacePathUrl(path: string): string {
//     return URI.file( path).toString();
// }

function createDidOpenTextDocumentParams(uri: string, text: string): DidOpenTextDocumentParams {
    return {
        textDocument: {
            uri,
            languageId: "plaintext",
            version: 1,
            text
        }
    };
}

// @ts-ignore
function _createDidCloseTextDocumentParams(uri: string): DidCloseTextDocumentParams {
    return {
        textDocument: {
            uri: uri
        }
    };
}

function createDidChangeWatchedFilesParams(uri: string, type: FileChangeType): DidChangeWatchedFilesParams {
    // return a complete object of type DidChangeWatchedFilesParams including all non-optional properties

    return {
        changes: [
            {
                uri: uri,
                type: type 
            }
        ]
    };
}

describe('DocumentChangeTracker', () => {
    let documentChangeTracker: DocumentChangeTracker;
    let editQueue: EditQueue;
    let globs: string[];
    let requester: Requester;

    beforeEach(() => {
        editQueue = new EditQueue(requester);
        globs = ['**/*.ghul'];

        editQueue = {
            queueEdit3: // jest mock that logs its arguments to the console log when called
                jest.fn((uri: string, version: number | null, text: string) => {
                    console.log(`QQQQQQ queueEdit3: uri: ${uri}, version: ${version}, text: ${text}`);
                })
        } as unknown as EditQueue;

        documentChangeTracker = new DocumentChangeTracker(editQueue, globs);
    });

    it('should add an open document to the set', () => {
        const uri = 'file:///path/to/document.ghul';
        const event = createTextDocumentChangeEvent(uri, 'console.log("Hello, world!");');

        documentChangeTracker.onDidOpen(event);

        expect(documentChangeTracker.isOpen(uri)).toBe(true);
    });

    it('should remove a closed document from the set', () => {
        const uri = 'file:///path/to/document.ghul';
        const event = createTextDocumentChangeEvent(uri, 'console.log("Hello, world!");');

        documentChangeTracker.open_documents.add(uri);

        documentChangeTracker.onDidClose(event);

        expect(documentChangeTracker.isOpen(uri)).toBe(false);
    });

    it('should queue an edit when a text document is opened', () => {
        const uri = 'file:///path/to/document.ghul';
        const text = 'console.log("Hello, world!");';
        const params = createDidOpenTextDocumentParams(uri, text);

        documentChangeTracker.onDidOpenTextDocument(params);

        expect(editQueue.queueEdit3).toHaveBeenCalledWith(uri, null, text);
    });

    it('should queue edits for changed or created files', () => {
        const uri = 'file:///path/to/document.ghul';
        const type = 1 /* FileChangeType.Changed */;

        const params = createDidChangeWatchedFilesParams(uri, type);
        const file_contents = "file contents";

        jest.spyOn(fs, 'readFileSync').mockImplementation((_path, _encoding) => file_contents);

        documentChangeTracker.onDidChangeWatchedFiles(params);

        expect(editQueue.queueEdit3).toHaveBeenCalledWith(uri, null, file_contents);
    });

    it('should return the valid source file', () => {
        const path = '/path/to/document.ghul';
        const uri = URI.file(path).toString();
        const validSourceFile = documentChangeTracker.tryGetValidSourceFile(uri);

        expect(validSourceFile).toBe(path);
    });

    it('should return null for an invalid source file', () => {
        const uri = 'file:///path/to/document.js';
        const invalidSourceFile = documentChangeTracker.tryGetValidSourceFile(uri);

        expect(invalidSourceFile).toBeNull();
    });
});