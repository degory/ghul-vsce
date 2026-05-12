import { DidChangeWatchedFilesParams, DidCloseTextDocumentParams, FileChangeType } from 'vscode-languageserver';

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

    it('should queue edit with empty file text for deleted files', () => {
        const uri = 'file:///path/to/document.ghul';
        const type = FileChangeType.Deleted;

        const params = createDidChangeWatchedFilesParams(uri, type);

        documentChangeTracker.onDidChangeWatchedFiles(params);

        expect(editQueue.queueEdit3).toHaveBeenCalledWith(uri, null, "");
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

    it('should return the valid source file for a Windows path', () => {
        const path = 'C:\\path\\to\\document.ghul';
        const uri = URI.file(path).toString();
        const validSourceFile = documentChangeTracker.tryGetValidSourceFile(uri);

        expect(validSourceFile?.toLowerCase()).toBe(path.toLowerCase());
    });

    it('should send an edit for a newly created file with contents read from disk', () => {
        const uri = 'file:///path/to/document.ghul';
        const type = FileChangeType.Created;

        // mock fs.readFileSync to return "contents of file"

        const fs = require('fs');
        fs.readFileSync = jest.fn(() => "contents of file");

        const params = createDidChangeWatchedFilesParams(uri, type);

        documentChangeTracker.onDidChangeWatchedFiles(params);

        expect(editQueue.queueEdit3).toHaveBeenCalledWith(uri, null, "contents of file");
    });

    it('returns early when params has no changes', () => {
        documentChangeTracker.onDidChangeWatchedFiles({ changes: undefined } as any);

        expect(editQueue.queueEdit3).not.toHaveBeenCalled();
    });

    it('returns early when params itself is null-ish', () => {
        documentChangeTracker.onDidChangeWatchedFiles(null as any);

        expect(editQueue.queueEdit3).not.toHaveBeenCalled();
    });

    it('returns null for a non-file:// uri (tryGetValidSourceFile)', () => {
        expect(documentChangeTracker.tryGetValidSourceFile('http://example.com/x.ghul')).toBeNull();
        expect(documentChangeTracker.tryGetValidSourceFile('untitled:foo.ghul')).toBeNull();
    });

    it('ignores changes for files that fall outside the configured globs', () => {
        // .js doesn't match **/*.ghul → tryGetValidSourceFile returns null,
        // the loop continues without queueing:
        const params = createDidChangeWatchedFilesParams(
            'file:///path/to/document.js',
            FileChangeType.Created
        );

        documentChangeTracker.onDidChangeWatchedFiles(params);

        expect(editQueue.queueEdit3).not.toHaveBeenCalled();
    });

    describe('project-file changes trigger a debounced re-initialise', () => {
        // debounced_reinitialize() schedules a real setTimeout(5000) that
        // would later call ExtensionState.getInstance().connection_event_handler
        // .initialize() and NPE in test context. Fake-timer-isolate so the
        // schedule is registered but never fires:
        beforeAll(() => { jest.useFakeTimers(); });
        afterAll(() => { jest.useRealTimers(); });

        it.each([
            ['file:///workspace/test.ghulproj'],
            ['file:///workspace/Directory.Build.props'],
            ['file:///workspace/.config/dotnet-tools.json'],
        ])('returns after seeing a project-relevant change for %s (does not queue)', uri => {
            const params = createDidChangeWatchedFilesParams(uri, FileChangeType.Changed);

            documentChangeTracker.onDidChangeWatchedFiles(params);

            // The function returns early after scheduling debounced_reinitialize:
            expect(editQueue.queueEdit3).not.toHaveBeenCalled();
        });
    });
});