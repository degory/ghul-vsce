import { ResponseParser } from '../src/response-parser';
import { ResponseHandler } from '../src/response-handler';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { Watchdog } from '../src/watchdog';
import { ExtensionState } from '../src/extension-state';
import { Connection } from 'vscode-languageserver';

// Records every handler call from the parser so tests can assert dispatch:
class RecordingHandler {
    calls: Array<{ method: string; lines?: string[] }> = [];

    handleListen() { this.calls.push({ method: 'handleListen' }); }
    handleDiagnostics(lines: string[]) { this.calls.push({ method: 'handleDiagnostics', lines }); }
    handlePartialCompileDone(lines: string[]) { this.calls.push({ method: 'handlePartialCompileDone', lines }); }
    handleFullCompileDone(lines: string[]) { this.calls.push({ method: 'handleFullCompileDone', lines }); }
    handleHover(lines: string[]) { this.calls.push({ method: 'handleHover', lines }); }
    handleDefinition(lines: string[]) { this.calls.push({ method: 'handleDefinition', lines }); }
    handleDeclaration(lines: string[]) { this.calls.push({ method: 'handleDeclaration', lines }); }
    handleCompletion(lines: string[]) { this.calls.push({ method: 'handleCompletion', lines }); }
    handleSignature(lines: string[]) { this.calls.push({ method: 'handleSignature', lines }); }
    handleSymbols(lines: string[]) { this.calls.push({ method: 'handleSymbols', lines }); }
    handleReferences(lines: string[]) { this.calls.push({ method: 'handleReferences', lines }); }
    handleImplementation(lines: string[]) { this.calls.push({ method: 'handleImplementation', lines }); }
    handleRenameRequest(lines: string[]) { this.calls.push({ method: 'handleRenameRequest', lines }); }
    handleRestart() { this.calls.push({ method: 'handleRestart' }); }
    handleUnexpected() { this.calls.push({ method: 'handleUnexpected' }); }
}

// ResponseParser calls clearWatchdog / rejectAllPendingPromises on the
// extension-state singleton, so wire a real Watchdog + ResponseHandler in.
function wireSingleton(): { handler: ResponseHandler } {
    const state = ExtensionState.getInstance();
    state.watchdog = new Watchdog(1000, () => {});

    const connection = {} as Connection;
    const config = new ConfigEventEmitter();
    const handler = new ResponseHandler(connection, config);
    state.response_handler = handler;

    return { handler };
}

function makeSection(command: string, lines: string[] = []) {
    return command + '\n' + lines.join('\n') + (lines.length ? '\n' : '') + '\f';
}

describe('ResponseParser', () => {
    let recorder: RecordingHandler;
    let parser: ResponseParser;

    beforeEach(() => {
        wireSingleton();
        recorder = new RecordingHandler();
        parser = new ResponseParser(recorder as unknown as ResponseHandler);
    });

    it('buffers until form-feed delimiter is seen', () => {
        parser.handleChunk('LISTEN\n');
        expect(recorder.calls).toEqual([]);

        parser.handleChunk('\f');
        expect(recorder.calls).toEqual([{ method: 'handleListen' }]);
    });

    it('handles multiple sections in one chunk', () => {
        parser.handleChunk(makeSection('LISTEN') + makeSection('RESTART'));

        expect(recorder.calls.map(c => c.method)).toEqual(['handleListen', 'handleRestart']);
    });

    it('strips carriage returns', () => {
        parser.handleChunk('LISTEN\r\n\r\f');
        expect(recorder.calls.map(c => c.method)).toEqual(['handleListen']);
    });

    it.each([
        ['DIAGNOSTICS', 'handleDiagnostics'],
        ['PARTIAL DONE', 'handlePartialCompileDone'],
        ['FULL DONE', 'handleFullCompileDone'],
        ['HOVER', 'handleHover'],
        ['DEFINITION', 'handleDefinition'],
        ['DECLARATION', 'handleDeclaration'],
        ['COMPLETION', 'handleCompletion'],
        ['SIGNATURE', 'handleSignature'],
        ['SYMBOLS', 'handleSymbols'],
        ['REFERENCES', 'handleReferences'],
        ['IMPLEMENTATION', 'handleImplementation'],
        ['RENAMEREQUEST', 'handleRenameRequest'],
    ])('dispatches %s -> %s with lines', (command, method) => {
        parser.handleChunk(makeSection(command, ['line1', 'line2']));

        expect(recorder.calls).toEqual([{ method, lines: ['line1', 'line2'] }]);
    });

    it('dispatches LISTEN with no lines', () => {
        parser.handleChunk(makeSection('LISTEN'));
        expect(recorder.calls).toEqual([{ method: 'handleListen' }]);
    });

    it('dispatches RESTART with no lines', () => {
        parser.handleChunk(makeSection('RESTART'));
        expect(recorder.calls).toEqual([{ method: 'handleRestart' }]);
    });

    it('treats unknown command as unexpected', () => {
        parser.handleChunk(makeSection('NOSUCH'));

        expect(recorder.calls).toEqual([{ method: 'handleUnexpected' }]);
    });

    it('logs and rejects on a too-short section (no command line)', () => {
        // single line + form feed = section with one element after split
        parser.handleChunk('only-one-line\f');

        // No dispatch happened (the section had < 2 lines and was rejected):
        expect(recorder.calls).toEqual([]);
    });

    it('reassembles a section split across two chunks', () => {
        parser.handleChunk('LIST');
        parser.handleChunk('EN\n\f');

        expect(recorder.calls.map(c => c.method)).toEqual(['handleListen']);
    });
});
