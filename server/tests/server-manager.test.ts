import { ServerManager, ServerState } from '../src/server-manager';
import { ServerEventEmitter } from '../src/server-event-emitter';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { EditQueue } from '../src/edit-queue';
import { ResponseParser } from '../src/response-parser';

// We only exercise the small state-transition surface here. start() spawns
// a real process and would need heavy mocking of child_process — out of scope.

describe('ServerManager (state helpers)', () => {
    let manager: ServerManager;
    let serverEvents: ServerEventEmitter;
    let configEvents: ConfigEventEmitter;

    beforeEach(() => {
        serverEvents = new ServerEventEmitter();
        configEvents = new ConfigEventEmitter();

        manager = new ServerManager(
            configEvents,
            serverEvents,
            {} as EditQueue,
            {} as ResponseParser,
        );
    });

    describe('startListening', () => {
        it('moves to Listening and emits listening event', () => {
            const handler = jest.fn();
            serverEvents.onListening(handler);

            manager.startListening();

            expect(manager.state()).toBe(ServerState.Listening);
            expect(handler).toHaveBeenCalled();
        });

        it('does nothing when the server is Blocked', () => {
            manager.server_state = ServerState.Blocked;
            const handler = jest.fn();
            serverEvents.onListening(handler);

            manager.startListening();

            expect(manager.state()).toBe(ServerState.Blocked);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('abort', () => {
        it('moves to Aborted and emits the abort event on the bus', () => {
            // The raw event name is 'aborted'; see server-event-emitter tests.
            const rawHandler = jest.fn();
            serverEvents.on('aborted', rawHandler);

            manager.abort();

            expect(manager.state()).toBe(ServerState.Aborted);
            expect(rawHandler).toHaveBeenCalledTimes(1);
        });

        it('does nothing when Blocked', () => {
            manager.server_state = ServerState.Blocked;
            const rawHandler = jest.fn();
            serverEvents.on('aborted', rawHandler);

            manager.abort();

            expect(manager.state()).toBe(ServerState.Blocked);
            expect(rawHandler).not.toHaveBeenCalled();
        });
    });

    describe('kill', () => {
        it('emits killing and aborts when child.kill() throws', () => {
            const killingHandler = jest.fn();
            const rawAbortHandler = jest.fn();
            serverEvents.onKilling(killingHandler);
            serverEvents.on('aborted', rawAbortHandler);

            // No this.child — child.kill() throws TypeError → catch → abort()
            manager.kill();

            expect(killingHandler).toHaveBeenCalled();
            expect(rawAbortHandler).toHaveBeenCalled();
            expect(manager.state()).toBe(ServerState.Aborted);
        });

        it('completes the happy path when child.kill() succeeds', () => {
            const killing = jest.fn();
            const killed = jest.fn();
            serverEvents.onKilling(killing);
            serverEvents.onKilled(killed);

            manager.child = { kill: jest.fn() } as any;

            manager.kill();

            expect(killing).toHaveBeenCalled();
            expect(killed).toHaveBeenCalled();
            expect(manager.expecting_exit).toBe(true);
            expect((manager.child!.kill as jest.Mock)).toHaveBeenCalled();
        });
    });

    describe('killQuiet', () => {
        it('is a no-op (covers it for parity)', () => {
            expect(() => manager.killQuiet()).not.toThrow();
        });
    });
});
