import {
	spawn,
	ChildProcess
} from 'child_process';

import { log, rejectAllPendingPromises } from './server';

import { GhulConfig } from './ghul-config';

import { ResponseParser } from './response-parser';

import { ServerEventEmitter } from './server-event-emitter';

import { ConfigEventEmitter } from './config-event-emitter';

export enum ServerState {
	Cold,
	StartingUp,
	Listening,
	Aborted
}

export class ServerManager {
	child: ChildProcess;

	event_emitter: ServerEventEmitter;

	server_state: ServerState;
	ghul_config: GhulConfig;
	workspace_root: string;
	response_parser: ResponseParser;

	constructor(
		config_event_source: ConfigEventEmitter,
		event_emitter: ServerEventEmitter,
		response_parser: ResponseParser
	) {
		this.event_emitter = event_emitter;
		this.response_parser = response_parser;

		config_event_source.onConfigAvailable((workspace: string, config: GhulConfig) => {
			this.workspace_root = workspace;
			this.ghul_config = config;

			this.start();
		});
	}

	start() {
		this.event_emitter.starting();

		this.server_state = ServerState.StartingUp;
	
		let ghul_compiler = this.ghul_config.compiler;

		let other_flags = this.ghul_config.other_flags;
		
		log("starting ghūl compiler '" + ghul_compiler + "'");

		this.child = spawn("mono", [ ghul_compiler, "-A", ...other_flags ]);

		this.event_emitter.running(this.child);
	
		this.child.stderr.on('data', (chunk: string) => {
			process.stderr.write(chunk);
		});
	
		this.child.stdout.on('data', (chunk: string) => {
			this.response_parser.handleChunk(chunk);
		});
	
		this.child.on('exit',
			(_code: number, _signal: string) => {
				log("ghūl compiler exited - restarting");

				rejectAllPendingPromises("restarting");
	
				// this.abort();

				// rejectAllAndThrow("ghūl compiler exited unexpectedly");
			}
		);
	}	
	
	state() {
		return this.server_state;
	}

	startListening() {
		this.server_state = ServerState.Listening;

		console.log("emit listening event");

		this.event_emitter.listening();
	}

	abort() {
		this.server_state = ServerState.Aborted;

		this.event_emitter.abort();
	}

	kill() {
		this.event_emitter.killing();

		log("kill any running ghūl compiler container...");
		try {
	
			this.event_emitter.killed();
		} catch (e) {
			log("something went wrong killing ghūl compiler container: " + e);			
			this.abort();
		}
	}

	killQuiet() {
	}
}