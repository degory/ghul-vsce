import { Watchdog } from '../src/watchdog';
import { ExtensionState } from '../src/extension-state';
import { ResponseHandler } from '../src/response-handler';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { Connection } from 'vscode-languageserver';

// onWatchdogTimeout() calls rejectAllAndThrow() on the extension-state
// singleton. Wire a real ResponseHandler so that path doesn't NPE.
function wireSingletonForRejection() {
    const state = ExtensionState.getInstance();
    const connection = {} as Connection;
    const config = new ConfigEventEmitter();
    state.response_handler = new ResponseHandler(connection, config);
}

describe('Watchdog', () => {
    let watchdog: Watchdog;

    beforeEach(() => {
        jest.useFakeTimers();
        wireSingletonForRejection();
        watchdog = new Watchdog(1000);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('does not fire if cleared before the timeout', () => {
        watchdog.startWatchdog();
        watchdog.clearWatchdog();

        jest.advanceTimersByTime(2000);

        // We can prove no throw by simply running the timer; if a timeout
        // had fired, rejectAllAndThrow() would have thrown synchronously.
        // (Hardened: also assert the timer slot is null.)
        expect(watchdog.watchdog_timer).toBeNull();
    });

    it('fires after the timeout, calling rejectAllAndThrow', () => {
        watchdog.startWatchdog();

        expect(() => jest.advanceTimersByTime(1500)).toThrow(/watchdog timeout/);
    });

    it('startWatchdogIfNotRunning is idempotent while a timer is set', () => {
        watchdog.startWatchdogIfNotRunning();
        const firstTimer = watchdog.watchdog_timer;

        watchdog.startWatchdogIfNotRunning();

        expect(watchdog.watchdog_timer).toBe(firstTimer);
        // Cleanup so afterEach's useRealTimers doesn't leave a dangling handle:
        watchdog.clearWatchdog();
    });

    it('resetWatchdog restarts the timer with the configured timeout', () => {
        watchdog.startWatchdog();
        jest.advanceTimersByTime(800);

        watchdog.resetWatchdog();
        // 500ms after reset (and 1300 total) – pre-reset would have fired by now
        jest.advanceTimersByTime(500);

        expect(() => jest.advanceTimersByTime(600)).toThrow(/watchdog timeout/);
    });

    it('setTimeout clamps below 1000ms up to 1000ms', () => {
        watchdog.setTimeout(500);
        expect(watchdog.timeout_milliseconds).toBe(1000);
    });

    it('setTimeout accepts values >= 1000ms unchanged', () => {
        watchdog.setTimeout(5000);
        expect(watchdog.timeout_milliseconds).toBe(5000);
    });

    it('clearWatchdog on an unstarted watchdog is a no-op', () => {
        expect(() => watchdog.clearWatchdog()).not.toThrow();
        expect(watchdog.watchdog_timer).toBeUndefined();
    });
});
