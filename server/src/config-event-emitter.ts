import { EventEmitter } from 'events';

import { GhulConfig } from './ghul-config';

export class ConfigEventEmitter extends EventEmitter {
	constructor(
	) {
		super();
	}

    configAvailable(workspace: string, config: GhulConfig) {
        this.emit('config-available', workspace, config);
    }

    onConfigAvailable(handler: (workspace: string, config: GhulConfig) => void) {
        this.on('config-available', handler);
    }
}