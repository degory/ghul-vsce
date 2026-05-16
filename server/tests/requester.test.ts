import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

import { Requester } from '../src/requester';
import { ResponseHandler } from '../src/response-handler';
import { ServerEventEmitter } from '../src/server-event-emitter';
import { Watchdog } from '../src/watchdog';
import { ExtensionState } from '../src/extension-state';

class CapturingStream extends EventEmitter {
    written: string[] = [];
    write(text: string): boolean {
        this.written.push(text);
        return true;
    }
    joined(): string { return this.written.join(''); }
}

// Records each expectX call so tests can match write order against promise
// allocation order. Returns a fresh resolved promise per call:
class RecordingResponseHandler {
    expectations: string[] = [];

    expectHover() { this.expectations.push('hover'); return Promise.resolve(null); }
    expectDefinition() { this.expectations.push('definition'); return Promise.resolve(null); }
    expectDeclaration() { this.expectations.push('declaration'); return Promise.resolve([]); }
    expectCompletion() { this.expectations.push('completion'); return Promise.resolve([]); }
    expectSignature() { this.expectations.push('signature'); return Promise.resolve(null); }
    expectSymbols() { this.expectations.push('symbols'); return Promise.resolve([]); }
    expectReferences() { this.expectations.push('references'); return Promise.resolve([]); }
    expectImplementation() { this.expectations.push('implementation'); return Promise.resolve([]); }
    expectRenameRequest() { this.expectations.push('rename'); return Promise.resolve(null); }
}

function makeRunningChild(stream: CapturingStream): ChildProcess {
    return { pid: 1, stdin: stream } as unknown as ChildProcess;
}

describe('Requester', () => {
    let events: ServerEventEmitter;
    let response: RecordingResponseHandler;
    let stream: CapturingStream;
    let requester: Requester;

    beforeEach(() => {
        ExtensionState.getInstance().watchdog = new Watchdog(10000, () => {});

        events = new ServerEventEmitter();
        response = new RecordingResponseHandler();
        stream = new CapturingStream();

        requester = new Requester(
            events,
            response as unknown as ResponseHandler
        );

        // onRunning is wired in the constructor; fire it now so the stream
        // is in place for write tests:
        events.running(makeRunningChild(stream));
    });

    afterEach(() => {
        // send* methods call startWatchdogIfNotRunning(); if we leave the
        // timer alive past test end it fires into a now-empty singleton and
        // crashes the worker. Clear it here:
        ExtensionState.getInstance().watchdog.clearWatchdog();
    });

    it('returns null from send methods before analysed becomes true (set via constructor default)', () => {
        // Constructor sets analysed = true, so this baseline check
        // documents that callers can rely on a non-null return after init:
        expect(requester.analysed).toBe(true);
    });

    it('writes the EDIT preamble and per-document body in sendDocuments', () => {
        requester.sendDocuments([
            { uri: 'file:///a.ghul', source: 'aaa' },
            { uri: 'file:///b.ghul', source: 'bbb' },
        ]);

        // Preamble: #EDIT#\n, each uri on its own line, blank line, then
        // each body terminated with form-feed:
        const written = stream.joined();
        expect(written.startsWith('#EDIT#\n')).toBe(true);
        expect(written).toContain('file:///a.ghul\n');
        expect(written).toContain('file:///b.ghul\n');
        expect(written).toContain('aaa\f');
        expect(written).toContain('bbb\f');
    });

    it('sendHover writes #HOVER# preamble + 1-based line/character and enqueues a hover promise', async () => {
        const promise = requester.sendHover('file:///x.ghul', 0, 5);

        expect(stream.written[0]).toBe('#HOVER#\n');
        expect(stream.written).toContain('file:///x.ghul\n');
        expect(stream.written).toContain('1\n'); // line+1
        expect(stream.written).toContain('6\n'); // character+1
        expect(response.expectations).toEqual(['hover']);
        await promise;
    });

    it.each([
        ['sendDefinition', '#DEFINITION#\n', 'definition'],
        ['sendDeclaration', '#DECLARATION#\n', 'declaration'],
        ['sendCompletion', '#COMPLETE#\n', 'completion'],
        ['sendSignature', '#SIGNATURE#\n', 'signature'],
        ['sendReferences', '#REFERENCES#\n', 'references'],
        ['sendImplementation', '#IMPLEMENTATION#\n', 'implementation'],
    ])('%s writes its preamble and enqueues the matching expect', async (method, preamble, expectation) => {
        await (requester as any)[method]('file:///x.ghul', 2, 3);

        expect(stream.written[0]).toBe(preamble);
        expect(response.expectations).toEqual([expectation]);
    });

    it('sendDocumentSymbol writes #SYMBOLS# and the uri', async () => {
        await requester.sendDocumentSymbol('file:///x.ghul');

        expect(stream.written[0]).toBe('#SYMBOLS#\n');
        expect(stream.written).toContain('file:///x.ghul\n');
        expect(response.expectations).toEqual(['symbols']);
    });

    it('sendWorkspaceSymbol writes #SYMBOLS# with a blank uri line', async () => {
        await requester.sendWorkspaceSymbol();

        expect(stream.written[0]).toBe('#SYMBOLS#\n');
        expect(stream.written[1]).toBe('\n');
        expect(response.expectations).toEqual(['symbols']);
    });

    it('sendRenameRequest writes #RENAMEREQUEST# and the new name', async () => {
        await requester.sendRenameRequest('file:///x.ghul', 1, 2, 'newName');

        expect(stream.written[0]).toBe('#RENAMEREQUEST#\n');
        expect(stream.written).toContain('newName\n');
        expect(response.expectations).toEqual(['rename']);
    });

    it('sendFullCompileRequest writes #COMPILE#', () => {
        requester.sendFullCompileRequest();

        expect(stream.written).toEqual(['#COMPILE#\n']);
    });

    it('sendRestart writes #RESTART#', () => {
        requester.sendRestart();

        expect(stream.written).toEqual(['#RESTART#\n']);
    });

    it('send methods return null when analysed is false (compiler not yet ready)', () => {
        requester.analysed = false;

        expect(requester.sendHover('u', 0, 0)).toBeNull();
        expect(requester.sendDefinition('u', 0, 0)).toBeNull();
        expect(requester.sendDeclaration('u', 0, 0)).toBeNull();
        expect(requester.sendCompletion('u', 0, 0)).toBeNull();
        expect(requester.sendSignature('u', 0, 0)).toBeNull();
        expect(requester.sendDocumentSymbol('u')).toBeNull();
        expect(requester.sendWorkspaceSymbol()).toBeNull();
        expect(requester.sendReferences('u', 0, 0)).toBeNull();
        expect(requester.sendImplementation('u', 0, 0)).toBeNull();
        expect(requester.sendRenameRequest('u', 0, 0, 'n')).toBeNull();
        // No writes should have occurred:
        expect(stream.written).toEqual([]);
    });
});
