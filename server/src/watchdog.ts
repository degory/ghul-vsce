
import { rejectAllAndThrow } from './extension-state';

/*
type Timer = NodeJS.Timeout & { getRemainingTime: () => number };

function createTimer(callback: () => void, delay: number): Timer {
    const startTime = Date.now();
    const timer = setTimeout(callback, delay) as Timer;

    timer.getRemainingTime = () => {
        const currentTime = Date.now();
        const elapsedTime = currentTime - startTime;
        return Math.max(delay - elapsedTime, 0);
    };

    return timer;
}
*/

type Timer = NodeJS.Timer;

function createTimer(callback: () => void, delay: number): Timer {
    return setTimeout(callback, delay);
}

export class Watchdog {
    watchdog_timer: Timer;
    timeout_milliseconds: number;

    constructor(timeout_milliseconds: number) {
        this.timeout_milliseconds = timeout_milliseconds;
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
        this.watchdog_timer = createTimer(() => { this.onWatchdogTimeout() }, this.timeout_milliseconds);
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
    
    onWatchdogTimeout() {
        rejectAllAndThrow("ghūl language extension: compiler watchdog timeout");
    }    
}