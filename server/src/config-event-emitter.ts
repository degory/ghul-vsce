import { EventEmitter } from 'events';

import { GhulConfig } from './ghul-config';
import { log } from 'console';

export class ConfigEventEmitter extends EventEmitter {
	constructor(
	) {
        log("ConfigEventEmitter constructor");
		super();
	}

    configAvailable(workspace: string, config: GhulConfig) {
        log("ConfigEventEmitter configAvailable", workspace, config);
        this.emit('config-available', workspace, config);
    }

    onConfigAvailable(handler: (workspace: string, config: GhulConfig) => void) {
        log("ConfigEventEmitter onConfigAvailable: set handler: ", handler);
        this.on('config-available', handler);
    }
}