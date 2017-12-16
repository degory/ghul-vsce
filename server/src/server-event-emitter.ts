import { EventEmitter } from 'events'

import { ChildProcess } from 'child_process';

import { log } from './server';

export class ServerEventEmitter extends EventEmitter {
	constructor(
	) {
		super();
	}

	starting() {
        this.emit('starting');
    }

    running(child: ChildProcess) {
        log("now running, have child process");
        this.emit('running', child);
	}	
	
	listening() {
		this.emit('listening');
    }
    
    analysed() {
        this.emit('analysed');
    }

	abort() {
		this.emit('aborted');
	}

	killing() {
		this.emit('killing');
    }
    
    killed() {
        this.emit('killed');
    }

    onStarting(handler: () => void) {
        this.on('starting', handler);
    }

    onRunning(handler: (child: ChildProcess) => void) {
        this.on('running', handler);
    }

    onListening(handler: () => void) {
        this.on('listening', handler);
    }

    onAnalysed(handler: () => void) {
        this.on('analysed', handler);
    }

    onAbort(handler: () => void) {
        this.on('abort', handler);
    }

    onKilling(handler: () => void) {
        this.on('killing', handler);
    }

    onKilled(handler: () => void) {
        this.on('killed', handler);
    }
}