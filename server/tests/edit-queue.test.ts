import { TextDocumentChangeEvent } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { EditQueue } from '../src/edit-queue';
import { Requester } from '../src/requester';
import { Watchdog } from '../src/watchdog';
import { ExtensionState } from '../src/extension-state';

// A minimal Requester stand-in that records every send for assertion.
// We use a class rather than jest.fn() so the test reads like a script.
class RecordingRequester {
    sendDocumentsCalls: Array<{ uri: string; source: string }[]> = [];
    sendFullCompileRequestCalls = 0;

    sendDocuments(documents: { uri: string; source: string }[]) {
        this.sendDocumentsCalls.push(documents);
    }
    sendFullCompileRequest() {
        this.sendFullCompileRequestCalls += 1;
    }
}

function makeChange(uri: string, version: number, text: string): TextDocumentChangeEvent<TextDocument> {
    return {
        document: TextDocument.create(uri, 'ghul', version, text),
    };
}

describe('EditQueue', () => {
    let recorder: RecordingRequester;
    let queue: EditQueue;

    beforeEach(() => {
        jest.useFakeTimers();
        // Watchdog gets touched via setWatchdogTimeout/getWatchdogTimeout from
        // edit-queue. Wire a real one so those calls don't NPE.
        ExtensionState.getInstance().watchdog = new Watchdog(10000);

        recorder = new RecordingRequester();
        queue = new EditQueue(recorder as unknown as Requester);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('queueEdit3', () => {
        it('stores pending changes without sending when in START state', () => {
            queue.queueEdit3('file:///a.ghul', 1, 'text');

            expect(queue.pending_changes.size).toBe(1);
            expect(recorder.sendDocumentsCalls).toEqual([]);
        });

        it('schedules an edit timer when transitioning out of IDLE', () => {
            queue.reset();
            queue.queueEdit3('file:///a.ghul', 1, 'text');

            // 100ms is PARTIAL_BUILD_EDIT_TIMEOUT; let the timer fire:
            jest.advanceTimersByTime(EditQueue.PARTIAL_BUILD_EDIT_TIMEOUT);

            expect(recorder.sendDocumentsCalls).toHaveLength(1);
            expect(recorder.sendDocumentsCalls[0]).toEqual([
                { uri: 'file:///a.ghul', source: 'text' },
            ]);
        });

        it('coalesces multiple edits for the same uri into one send', () => {
            queue.reset();
            queue.queueEdit3('file:///a.ghul', 1, 'first');
            queue.queueEdit3('file:///a.ghul', 2, 'second');

            // After the timer fires, only one send goes out and it carries
            // the latest text — Map keying by uri does the coalescing:
            jest.advanceTimersByTime(EditQueue.PARTIAL_BUILD_EDIT_TIMEOUT);

            expect(recorder.sendDocumentsCalls).toHaveLength(1);
            expect(recorder.sendDocumentsCalls[0]).toEqual([
                { uri: 'file:///a.ghul', source: 'second' },
            ]);
        });

        it('assigns a synthetic negative version when given a null version', () => {
            queue.queueEdit3('file:///a.ghul', null, 'text');

            const change = queue.pending_changes.get('file:///a.ghul');
            expect(change!.version).toBe(-1);
        });

        it('assigns a unique synthetic version each time', () => {
            queue.queueEdit3('file:///a.ghul', null, 't1');
            queue.queueEdit3('file:///b.ghul', null, 't2');

            const va = queue.pending_changes.get('file:///a.ghul')!.version;
            const vb = queue.pending_changes.get('file:///b.ghul')!.version;
            expect(va).toBe(-1);
            expect(vb).toBe(-2);
        });

        it('does not start a new timer when a partial compile is in flight', () => {
            queue.reset();
            queue.start([{ uri: 'file:///a.ghul', source: 'text' }]);
            // start() puts us into DOING_PARTIAL_COMPILE — another edit
            // should NOT trigger an immediate send:
            const sendsBefore = recorder.sendDocumentsCalls.length;

            queue.queueEdit3('file:///a.ghul', 2, 'newtext');
            jest.advanceTimersByTime(EditQueue.PARTIAL_BUILD_EDIT_TIMEOUT * 2);

            expect(recorder.sendDocumentsCalls.length).toBe(sendsBefore);
            expect(queue.pending_changes.size).toBe(1);
        });
    });

    describe('queueEdit (TextDocumentChangeEvent overload)', () => {
        it('normalises the uri and queues the document text', () => {
            queue.reset();
            queue.queueEdit(makeChange('file:///dir/a.ghul', 1, 'hello'));

            const change = queue.pending_changes.get('file:///dir/a.ghul');
            expect(change!.text).toBe('hello');
        });
    });

    describe('onPartialCompileDone', () => {
        it('moves to WAITING_FOR_MORE_EDITS_AFTER_PARTIAL_COMPILE when nothing is pending', () => {
            queue.reset();
            queue.start([{ uri: 'file:///a.ghul', source: 't' }]);

            queue.onPartialCompileDone(50);

            // After the watchdog-timeout interval, requestFullCompile should fire:
            jest.advanceTimersByTime(EditQueue.FULL_BUILD_EDIT_TIMEOUT);
            expect(recorder.sendFullCompileRequestCalls).toBe(1);
        });

        it('moves to WAITING_FOR_MORE_EDITS when there are pending changes', () => {
            queue.reset();
            queue.start([{ uri: 'file:///a.ghul', source: 't' }]);
            // start() emits its own send; capture the count so we can check
            // exactly one further send follows the partial-done timer:
            const sendsAfterStart = recorder.sendDocumentsCalls.length;

            // Queue another edit while in DOING_PARTIAL_COMPILE — it just queues:
            queue.queueEdit3('file:///b.ghul', 1, 'b');

            queue.onPartialCompileDone(50);

            // 50 * 1.5 = 75ms timeout after this transition. Let it fire:
            jest.advanceTimersByTime(75);

            expect(recorder.sendDocumentsCalls).toHaveLength(sendsAfterStart + 1);
            expect(recorder.sendDocumentsCalls[recorder.sendDocumentsCalls.length - 1]).toEqual([
                { uri: 'file:///b.ghul', source: 'b' },
            ]);
        });

        it('bumps edit_timeout based on observed compile time', () => {
            queue.reset();
            queue.start([{ uri: 'file:///a.ghul', source: 't' }]);

            queue.onPartialCompileDone(200);
            expect(queue.edit_timeout).toBe(300); // 200 * 1.5
        });
    });

    describe('onFullCompileDone', () => {
        it('returns to IDLE when nothing is pending', () => {
            queue.reset();
            queue.forceScheduleFullCompile();
            // jump straight to DOING_FULL_COMPILE:
            jest.advanceTimersByTime(EditQueue.FULL_BUILD_EDIT_TIMEOUT);
            expect(recorder.sendFullCompileRequestCalls).toBe(1);

            queue.onFullCompileDone(100);

            // No further sends should occur:
            jest.advanceTimersByTime(10_000);
            expect(recorder.sendDocumentsCalls).toEqual([]);
        });

        it('clamps full_build_timeout to at least edit_timeout', () => {
            queue.reset();
            queue.start([{ uri: 'file:///a.ghul', source: 't' }]);
            queue.onPartialCompileDone(1000); // edit_timeout becomes 1500
            // simulate that we're in DOING_FULL_COMPILE before the next call:
            queue.forceScheduleFullCompile();
            jest.advanceTimersByTime(EditQueue.FULL_BUILD_EDIT_TIMEOUT);

            queue.onFullCompileDone(100); // would set full_build_timeout = 150
            expect(queue.full_build_timeout).toBe(queue.edit_timeout);
        });
    });

    describe('sendQueued', () => {
        it('drains pending_changes into a single send', () => {
            queue.reset();
            queue.queueEdit3('file:///a.ghul', 1, 'a');
            queue.queueEdit3('file:///b.ghul', 1, 'b');

            queue.sendQueued('test');

            expect(queue.pending_changes.size).toBe(0);
            expect(recorder.sendDocumentsCalls).toHaveLength(1);
            const docs = recorder.sendDocumentsCalls[0];
            expect(docs.map(d => d.uri).sort()).toEqual(['file:///a.ghul', 'file:///b.ghul']);
        });
    });

    describe('onDiagnosticsReceived', () => {
        it('transitions from START to IDLE', () => {
            expect(queue.state).toBeDefined();
            queue.onDiagnosticsReceived();

            // Calling onDiagnosticsReceived in any other state is a no-op,
            // so this is provable via behaviour: queueing now schedules a timer.
            queue.queueEdit3('file:///a.ghul', 1, 't');
            jest.advanceTimersByTime(EditQueue.PARTIAL_BUILD_EDIT_TIMEOUT);

            expect(recorder.sendDocumentsCalls).toHaveLength(1);
        });
    });
});
