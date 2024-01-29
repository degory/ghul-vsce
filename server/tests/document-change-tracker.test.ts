import { DidChangeWatchedFilesParams, DidCloseTextDocumentParams, FileChangeType } from 'vscode-languageserver';

import * as fs from 'fs';

import { DocumentChangeTracker } from '../src/document-change-tracker';
import { EditQueue } from '../src/edit-queue';
import { Requester } from '../src/requester';
import { URI } from 'vscode-uri';


jest.mock('../src/edit-queue');
jest.mock('../src/requester');
jest.mock('fs');


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