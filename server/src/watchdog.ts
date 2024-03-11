
import { rejectAllAndThrow } from './extension-state';

export class Watchdog {
    watchdog_timer: NodeJS.Timer;

    startWatchdog() {
        this.watchdog_timer = setTimeout(() => { this.onWatchdogTimeout() }, 10000);
    }

    resetWatchdog() {
        this.clearWatchdog();
        this.startWatchdog();
    }
    
    clearWatchdog() {
        if (this.watchdog_timer) {
            clearTimeout(this.watchdog_timer);
        }
    }
    
    onWatchdogTimeout() {
        rejectAllAndThrow("ghūl language extension: compiler watchdog timeout");
    }    
}