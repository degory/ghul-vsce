import { ChildProcess } from 'child_process';

import { ServerEventEmitter } from '../src/server-event-emitter';

describe('ServerEventEmitter', () => {
    let emitter: ServerEventEmitter;

    beforeEach(() => {
        emitter = new ServerEventEmitter();
    });

    it('fires onStarting when starting() is called', () => {
        const handler = jest.fn();
        emitter.onStarting(handler);

        emitter.starting();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('passes the child process to onRunning', () => {
        const handler = jest.fn();
        const child = { pid: 1234 } as ChildProcess;
        emitter.onRunning(handler);

        emitter.running(child);

        expect(handler).toHaveBeenCalledWith(child);
    });

    it('fires onListening when listening() is called', () => {
        const handler = jest.fn();
        emitter.onListening(handler);

        emitter.listening();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('fires onAnalysed when analysed() is called', () => {
        const handler = jest.fn();
        emitter.onAnalysed(handler);

        emitter.analysed();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('fires onKilling when killing() is called', () => {
        const handler = jest.fn();
        emitter.onKilling(handler);

        emitter.killing();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('fires onKilled when killed() is called', () => {
        const handler = jest.fn();
        emitter.onKilled(handler);

        emitter.killed();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    // Bug pinned: abort() emits 'aborted' but onAbort() subscribes to 'abort'.
    // Nothing in the codebase listens for 'aborted' directly, so onAbort
    // handlers never fire today. This test pins observed behaviour so any
    // future fix is a deliberate decision.
    it('onAbort handlers do NOT fire when abort() is called (pinned bug)', () => {
        const handler = jest.fn();
        emitter.onAbort(handler);

        emitter.abort();

        expect(handler).not.toHaveBeenCalled();
    });

    it("abort() emits 'aborted' (raw listener fires)", () => {
        const handler = jest.fn();
        emitter.on('aborted', handler);

        emitter.abort();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports multiple handlers on the same event', () => {
        const a = jest.fn();
        const b = jest.fn();
        emitter.onStarting(a);
        emitter.onStarting(b);

        emitter.starting();

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });
});
