import { log } from './log';

// A freshly launched compiler's first full compile is cold: the JIT and the
// compiler's symbol and reflection-metadata caches are unwarmed, so it can
// legitimately take far longer than a calibrated steady-state compile. Until
// that first compile lands and the edit queue narrows the timeout from a real
// measurement, the watchdog runs with this wide bound so it cannot mistake a
// healthy cold compiler for a wedged one.
export const COLD_START_TIMEOUT_MILLISECONDS = 60000;

// Bounds how long the extension waits for the compiler to answer a request.
// The timer is (re)started when a request is sent and cleared when any frame
// comes back; if it fires, the compiler is wedged — it has neither answered
// nor crashed — and the recovery callback kills and relaunches it.
export class Watchdog {
    watchdog_timer: NodeJS.Timeout;
    timeout_milliseconds: number;
    private on_timeout: () => void;
    private on_busy_changed: (busy: boolean) => void;

    // The timer's lifetime is exactly "a request is outstanding" — armed when
    // one is sent, cleared by the first frame back — which makes this the one
    // place that knows the compiler is working on something, whatever that
    // something is. on_busy_changed observes it so the user can be told about
    // a wait nothing else predicts: the analyser recompiles on demand to
    // answer a query and gives no advance notice that it is about to.
    constructor(
        timeout_milliseconds: number,
        on_timeout: () => void,
        on_busy_changed: (busy: boolean) => void = () => { }
    ) {
        this.timeout_milliseconds = timeout_milliseconds;
        this.on_timeout = on_timeout;
        this.on_busy_changed = on_busy_changed;
    }

    setTimeout(timeout_milliseconds: number) {
        this.timeout_milliseconds = timeout_milliseconds > 1000 ? timeout_milliseconds : 1000;
    }

    startWatchdogIfNotRunning() {
        if (!this.watchdog_timer) {
            this.startWatchdog();
        }
    }

    startWatchdog() {
        this.watchdog_timer = setTimeout(() => { this.onWatchdogTimeout(); }, this.timeout_milliseconds);

        this.on_busy_changed(true);
    }

    resetWatchdog() {
        this.clearWatchdog();
        this.startWatchdog();
    }

    clearWatchdog() {
        if (this.watchdog_timer) {
            clearTimeout(this.watchdog_timer);
            this.watchdog_timer = null;
        }

        this.on_busy_changed(false);
    }

    // Called on every (re)launch. Drops any timer still running against the
    // outgoing compiler and widens the timeout for the incoming one's cold
    // first compile. The edit queue narrows it again from the first measured
    // compile.
    enterColdStart() {
        this.clearWatchdog();
        this.timeout_milliseconds = COLD_START_TIMEOUT_MILLISECONDS;
    }

    // True while a request is outstanding: the timer runs from when a request
    // is sent until a response frame arrives.
    isRunning(): boolean {
        return this.watchdog_timer != null;
    }

    // The compiler has not answered within the timeout. A crash would have
    // fired the process 'exit' handler instead, so this is a wedge: nothing
    // recovers it on its own. Hand off to the recovery callback.
    private onWatchdogTimeout() {
        this.watchdog_timer = null;

        // The request is over, however badly: recovery kills the compiler, so
        // no frame is ever coming back to clear this.
        this.on_busy_changed(false);

        log("ghūl language extension: compiler watchdog timeout");

        this.on_timeout();
    }
}
