import {
    ExtensionState,
    getWatchdogTimeout,
    setWatchdogTimeout,
    startWatchdog,
    startWatchdogIfNotRunning,
    resetWatchdog,
    clearWatchdog,
    resolveAllPendingPromises,
    rejectAllPendingPromises,
    rejectAllAndThrow,
    reinitialize,
} from '../src/extension-state';
import { Watchdog } from '../src/watchdog';
import { ResponseHandler } from '../src/response-handler';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { Connection } from 'vscode-languageserver';

// The singleton is process-wide. Tests here verify the thin module-level
// functions that proxy into it; ExtensionState.connect() lives at the LSP
// wire boundary and is exercised in integration testing rather than here.

describe('extension-state module-level helpers', () => {
    let watchdog: Watchdog;
    let responseHandler: ResponseHandler;

    beforeEach(() => {
        jest.useFakeTimers();
        const state = ExtensionState.getInstance();
        watchdog = new Watchdog(2500);
        state.watchdog = watchdog;
        responseHandler = new ResponseHandler({} as Connection, new ConfigEventEmitter());
        state.response_handler = responseHandler;
    });

    afterEach(() => {
        ExtensionState.getInstance().watchdog.clearWatchdog();
        jest.useRealTimers();
    });

    it('getWatchdogTimeout returns the configured timeout', () => {
        expect(getWatchdogTimeout()).toBe(2500);
    });

    it('setWatchdogTimeout updates the timeout via Watchdog.setTimeout', () => {
        setWatchdogTimeout(7000);
        expect(getWatchdogTimeout()).toBe(7000);
    });

    it('setWatchdogTimeout clamps below 1000ms to 1000ms', () => {
        setWatchdogTimeout(300);
        expect(getWatchdogTimeout()).toBe(1000);
    });

    it('startWatchdog and clearWatchdog round-trip the timer state', () => {
        startWatchdog();
        expect(watchdog.watchdog_timer).toBeDefined();
        clearWatchdog();
        expect(watchdog.watchdog_timer).toBeNull();
    });

    it('startWatchdogIfNotRunning only starts once when called repeatedly', () => {
        startWatchdogIfNotRunning();
        const first = watchdog.watchdog_timer;
        startWatchdogIfNotRunning();
        expect(watchdog.watchdog_timer).toBe(first);
    });

    it('resetWatchdog restarts the timer', () => {
        startWatchdog();
        const first = watchdog.watchdog_timer;
        resetWatchdog();
        expect(watchdog.watchdog_timer).not.toBe(first);
    });

    it('resolveAllPendingPromises empties every queue in the response handler', () => {
        const hover = responseHandler.expectHover();
        resolveAllPendingPromises();
        return expect(hover).resolves.toBeNull();
    });

    it('rejectAllPendingPromises rejects every queue with the given message', async () => {
        const def = responseHandler.expectDefinition();
        rejectAllPendingPromises('boom');
        await expect(def).rejects.toBe('boom');
    });

    it('rejectAllAndThrow rejects pending promises AND throws the message', async () => {
        const def = responseHandler.expectDefinition();

        expect(() => rejectAllAndThrow('kaboom')).toThrow('kaboom');
        await expect(def).rejects.toBe('kaboom');
    });

    it('reinitialize delegates to the connection_event_handler', () => {
        const ceh = { initialize: jest.fn() };
        ExtensionState.getInstance().connection_event_handler = ceh as any;

        reinitialize();

        expect(ceh.initialize).toHaveBeenCalled();
    });

    it('getInstance returns the same instance on subsequent calls', () => {
        expect(ExtensionState.getInstance()).toBe(ExtensionState.getInstance());
    });
});
