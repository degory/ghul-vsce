import {
	spawn,
	ChildProcess
} from 'child_process';

import { log } from './log';
import { resolveAllPendingPromises } from './extension-state';

import { GhulConfig } from './ghul-config';

import { ResponseParser } from './response-parser';

import { ServerEventEmitter } from './server-event-emitter';

import { ConfigEventEmitter } from './config-event-emitter';
import { EditQueue } from './edit-queue';

export enum ServerState {
	Cold,
	StartingUp,
	Listening,
	Aborted
}

export class ServerManager {
	child: ChildProcess;
	expecting_exit: boolean;

	event_emitter: ServerEventEmitter;

	server_state: ServerState;
	ghul_config: GhulConfig;
	workspace_root: string;
	edit_queue: EditQueue;
	response_parser: ResponseParser;

	constructor(
		config_event_source: ConfigEventEmitter,
		event_emitter: ServerEventEmitter,
		edit_queue: EditQueue,
		response_parser: ResponseParser
	) {
		this.event_emitter = event_emitter;
		this.edit_queue = edit_queue;
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

		if (this.child) {
			log("killing running compiler PID " + this.child.pid);
			this.expecting_exit = true;

			this.child.kill();
		}

		this.child = spawn(ghul_compiler, this.ghul_config.arguments);

		this.child.on("error", err => {
			log(`ghūl compiler: failed to start: ${err.message}`);			
		});

		// FIXME: why does this event not fire?
		// this.child.on("spawn", () => {
			log(`spawned compiler process PID ${this.child.pid}`);

			this.child.stderr.on('data', (chunk: string) => {
				process.stderr.write(chunk);
			});
	
			this.child.stdout.on('data', (chunk: string) => {
				this.response_parser.handleChunk(chunk);
			});
	
			this.event_emitter.running(this.child);

			const pid = this.child?.pid;
		
			this.child.on('exit',
				(_code: number, _signal: string) => {
					const was_expecting_exit = this.expecting_exit;

					if (!was_expecting_exit) {
						log(`ghūl compiler ${pid}: unexpected exit`);
					} else {
						log(`ghūl compiler ${pid}: exited`);
					}

					this.child = null;

					resolveAllPendingPromises();

					if (!was_expecting_exit) {
						this.edit_queue.reset();
						log(`ghūl compiler ${pid}: will restart after unexpected exit`);
			
						this.start();
					} else {
						this.expecting_exit = false;
					}
				});
		// });			
	}	
	
	state() {
		return this.server_state;
	}

	startListening() {
		this.server_state = ServerState.Listening;

		this.event_emitter.listening();
	}

	abort() {
		this.server_state = ServerState.Aborted;

		this.event_emitter.abort();
	}

	kill() {
		this.event_emitter.killing();

		log("kill any running ghūl compiler...");

		try {
			this.expecting_exit = true;
			this.child.kill();
			this.event_emitter.killed();
		} catch (e) {
			log("something went wrong killing ghūl compiler container: " + e);			
			this.abort();
		}
	}

	killQuiet() {
	}
}