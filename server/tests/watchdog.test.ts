import { Watchdog, COLD_START_TIMEOUT_MILLISECONDS } from '../src/watchdog';

describe('Watchdog', () => {
    let watchdog: Watchdog;
    let onTimeout: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        onTimeout = jest.fn();
        watchdog = new Watchdog(1000, onTimeout);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('does not fire if cleared before the timeout', () => {
        watchdog.startWatchdog();
        watchdog.clearWatchdog();

        jest.advanceTimersByTime(2000);

        expect(onTimeout).not.toHaveBeenCalled();
        expect(watchdog.watchdog_timer).toBeNull();
    });

    it('fires the timeout handler after the timeout', () => {
        watchdog.startWatchdog();

        jest.advanceTimersByTime(1500);

        expect(onTimeout).toHaveBeenCalledTimes(1);
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
        // 500ms after reset (1300 total) — pre-reset would have fired by now:
        jest.advanceTimersByTime(500);
        expect(onTimeout).not.toHaveBeenCalled();

        jest.advanceTimersByTime(600);
        expect(onTimeout).toHaveBeenCalledTimes(1);
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

    it('enterColdStart widens the timeout to the cold-start bound', () => {
        watchdog.setTimeout(3676);

        watchdog.enterColdStart();

        expect(watchdog.timeout_milliseconds).toBe(COLD_START_TIMEOUT_MILLISECONDS);
    });

    it('enterColdStart drops a timer still running against the outgoing compiler', () => {
        watchdog.startWatchdog();

        watchdog.enterColdStart();

        expect(watchdog.watchdog_timer).toBeNull();

        // The dropped timer must not fire after the cold start.
        jest.advanceTimersByTime(2000);
        expect(onTimeout).not.toHaveBeenCalled();
    });
});
