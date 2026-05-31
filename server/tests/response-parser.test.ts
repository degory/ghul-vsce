import { ResponseParser } from '../src/response-parser';
import { ResponseHandler } from '../src/response-handler';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { Watchdog } from '../src/watchdog';
import { ExtensionState } from '../src/extension-state';
import { Connection } from 'vscode-languageserver';

// Records every handler call from the parser so tests can assert dispatch.
// Each entry captures the method name and (where the new typed handlers
// receive one) the full message object.
class RecordingHandler {
    calls: Array<{ method: string; message?: any }> = [];

    handleListen() { this.calls.push({ method: 'handleListen' }); }
    handleDiagnostics(message: any) { this.calls.push({ method: 'handleDiagnostics', message }); }
    handleHover(message: any) { this.calls.push({ method: 'handleHover', message }); }
    handleDefinition(message: any) { this.calls.push({ method: 'handleDefinition', message }); }
    handleDeclaration(message: any) { this.calls.push({ method: 'handleDeclaration', message }); }
    handleCompletion(message: any) { this.calls.push({ method: 'handleCompletion', message }); }
    handleSignature(message: any) { this.calls.push({ method: 'handleSignature', message }); }
    handleSymbols(message: any) { this.calls.push({ method: 'handleSymbols', message }); }
    handleReferences(message: any) { this.calls.push({ method: 'handleReferences', message }); }
    handleImplementation(message: any) { this.calls.push({ method: 'handleImplementation', message }); }
    handleTypeDefinition(message: any) { this.calls.push({ method: 'handleTypeDefinition', message }); }
    handleRenameRequest(message: any) { this.calls.push({ method: 'handleRenameRequest', message }); }
    handleDocumentFormatting(message: any) { this.calls.push({ method: 'handleDocumentFormatting', message }); }
    handleDocumentRangeFormatting(message: any) { this.calls.push({ method: 'handleDocumentRangeFormatting', message }); }
    handleSemanticTokens(message: any) { this.calls.push({ method: 'handleSemanticTokens', message }); }
    handleRestart() { this.calls.push({ method: 'handleRestart' }); }
    handleHeapCheckDone() { this.calls.push({ method: 'handleHeapCheckDone' }); }
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

// One protocol message is one JSON object terminated by a single \n.
function line(message: object): string {
    return JSON.stringify(message) + '\n';
}

describe('ResponseParser', () => {
    let recorder: RecordingHandler;
    let parser: ResponseParser;

    beforeEach(() => {
        wireSingleton();
        recorder = new RecordingHandler();
        parser = new ResponseParser(recorder as unknown as ResponseHandler);
    });

    it('buffers until the line is terminated by a newline', () => {
        parser.handleChunk(JSON.stringify({ kind: 'listen' }));
        expect(recorder.calls).toEqual([]);

        parser.handleChunk('\n');
        expect(recorder.calls).toEqual([{ method: 'handleListen' }]);
    });

    it('handles multiple messages in one chunk', () => {
        parser.handleChunk(line({ kind: 'listen' }) + line({ kind: 'restart' }));

        expect(recorder.calls.map(c => c.method)).toEqual(['handleListen', 'handleRestart']);
    });

    it('strips carriage returns', () => {
        // The compiler runs on the same line endings as the host, but VS Code
        // on Windows can introduce CRs. The parser should accept either.
        parser.handleChunk(line({ kind: 'listen' }).replace('\n', '\r\n'));
        expect(recorder.calls.map(c => c.method)).toEqual(['handleListen']);
    });

    it.each([
        [{ kind: 'diagnostics',     checked_paths: [], diagnostics: [], phase: 'query', elapsed_ms: 0, compile_needed: false }, 'handleDiagnostics'],
        [{ kind: 'hover',           description: 'h' }, 'handleHover'],
        [{ kind: 'definition',      locations: [] }, 'handleDefinition'],
        [{ kind: 'declaration',     locations: [] }, 'handleDeclaration'],
        [{ kind: 'completion',      items: [] }, 'handleCompletion'],
        [{ kind: 'signature',       best_signature_index: 0, current_parameter_index: 0, signatures: [] }, 'handleSignature'],
        [{ kind: 'symbols',         files: [] }, 'handleSymbols'],
        [{ kind: 'references',      locations: [] }, 'handleReferences'],
        [{ kind: 'implementation',  locations: [] }, 'handleImplementation'],
        [{ kind: 'type_definition', locations: [] }, 'handleTypeDefinition'],
        [{ kind: 'rename',          edits: [] }, 'handleRenameRequest'],
        [{ kind: 'format',          text: 'fmt' }, 'handleDocumentFormatting'],
        [{ kind: 'format_range',    start_line: 1, start_column: 1, end_line: 1, end_column: 5, text: 'fr' }, 'handleDocumentRangeFormatting'],
        [{ kind: 'semantic_tokens', tokens: [] }, 'handleSemanticTokens'],
    ])('dispatches a %p kind to its handler with the full message', (message, method) => {
        parser.handleChunk(line(message));

        expect(recorder.calls).toEqual([{ method, message }]);
    });

    it('dispatches listen with no payload', () => {
        parser.handleChunk(line({ kind: 'listen' }));
        expect(recorder.calls).toEqual([{ method: 'handleListen' }]);
    });

    it('dispatches restart with no payload', () => {
        parser.handleChunk(line({ kind: 'restart' }));
        expect(recorder.calls).toEqual([{ method: 'handleRestart' }]);
    });

    it('dispatches heap_check with no payload', () => {
        parser.handleChunk(line({ kind: 'heap_check' }));
        expect(recorder.calls).toEqual([{ method: 'handleHeapCheckDone' }]);
    });

    it('treats an unknown kind as unexpected', () => {
        parser.handleChunk(line({ kind: 'nosuch' }));

        expect(recorder.calls).toEqual([{ method: 'handleUnexpected' }]);
    });

    it('rejects pending promises on malformed JSON (without throwing through the parser)', () => {
        const reject = jest.spyOn(ExtensionState.getInstance().response_handler, 'rejectAllPendingPromises')
            .mockImplementation(() => {});

        parser.handleChunk('this is not json\n');

        expect(recorder.calls).toEqual([]);
        expect(reject).toHaveBeenCalled();
    });

    it('reassembles a message split across two chunks', () => {
        parser.handleChunk('{"kind":"lis');
        parser.handleChunk('ten"}\n');

        expect(recorder.calls.map(c => c.method)).toEqual(['handleListen']);
    });

    it('clears the watchdog on every dispatched message', () => {
        const clear = jest.spyOn(ExtensionState.getInstance().watchdog, 'clearWatchdog');

        parser.handleChunk(line({ kind: 'listen' }));

        expect(clear).toHaveBeenCalled();
    });

    it('skips blank lines emitted by trailing newlines', () => {
        parser.handleChunk(line({ kind: 'listen' }) + '\n' + line({ kind: 'restart' }));

        expect(recorder.calls.map(c => c.method)).toEqual(['handleListen', 'handleRestart']);
    });

    it('reset() discards a half-received line so a new compiler is parsed cleanly', () => {
        parser.handleChunk('{"kind":"lis');
        parser.reset();
        parser.handleChunk('ten"}\n');

        // After reset, "ten"}\n is alone in the buffer; not a valid JSON
        // object, so the parser logs + rejects but emits no dispatch.
        expect(recorder.calls).toEqual([]);
    });
});
