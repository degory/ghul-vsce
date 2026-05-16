import { log } from './log';

// Bounds how long the extension waits for the compiler to answer a request.
// The timer is (re)started when a request is sent and cleared when any frame
// comes back; if it fires, the compiler is wedged — it has neither answered
// nor crashed — and the recovery callback kills and relaunches it.
export class Watchdog {
    watchdog_timer: NodeJS.Timeout;
    timeout_milliseconds: number;
    private on_timeout: () => void;

    constructor(timeout_milliseconds: number, on_timeout: () => void) {
        this.timeout_milliseconds = timeout_milliseconds;
        this.on_timeout = on_timeout;
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
    }

    // The compiler has not answered within the timeout. A crash would have
    // fired the process 'exit' handler instead, so this is a wedge: nothing
    // recovers it on its own. Hand off to the recovery callback.
    private onWatchdogTimeout() {
        this.watchdog_timer = null;

        log("ghūl language extension: compiler watchdog timeout");

        this.on_timeout();
    }
}
