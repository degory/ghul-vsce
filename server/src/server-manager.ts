import { writeFileSync } from 'fs';
import { quote } from 'shell-quote';

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
	Aborted,
	Blocked
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

		if (this.ghul_config.block) {
			log("compiler block requested: won't spawn compiler");
			this.server_state = ServerState.Blocked;
			return;
		}

		writeFileSync(".analysis.rsp", quote(this.ghul_config.arguments));

		log(`compiler is "${quote(ghul_compiler)}"`);

		this.child = spawn(ghul_compiler[0], [...ghul_compiler.slice(1), "@.analysis.rsp"]);

		this.child.on("error", err => {
			log(`compiler: failed to start: ${err.message}`);			
		});

		log(`spawned compiler process PID ${this.child.pid}`);

		this.child.stderr.on('data', (chunk: Buffer) => {
			process.stderr.write(chunk);
		});

		this.child.stdout.on('data', (chunk: Buffer) => {
			this.response_parser.handleChunk(chunk.toString());
		});

		this.event_emitter.running(this.child);

		const pid = this.child?.pid;
	
		this.child.on('exit',
			(_code: number, _signal: string) => {
				const was_expecting_exit = this.expecting_exit;

				if (!was_expecting_exit) {
					log(`compiler PID ${pid}: unexpected exit`);
				} else {
					log(`compiler PID ${pid}: exited`);
				}

				this.child = null;

				resolveAllPendingPromises();

				if (!was_expecting_exit) {
					this.edit_queue.reset();
					log(`compiler PID ${pid}: will restart after unexpected exit`);
		
					this.start();
				} else {
					this.expecting_exit = false;
				}
			});
	}	
	
	state() {
		return this.server_state;
	}

	startListening() {
		if (this.server_state == ServerState.Blocked) {
			return;
		}

		this.server_state = ServerState.Listening;

		this.event_emitter.listening();
	}

	abort() {
		if (this.server_state == ServerState.Blocked) {
			return;
		}

		this.server_state = ServerState.Aborted;

		this.event_emitter.abort();
	}

	kill() {
		this.event_emitter.killing();

		log("killing any running compiler...");

		try {
			this.expecting_exit = true;
			this.child.kill();
			this.event_emitter.killed();
			log("finished killing compiler");
		} catch (e) {
			log("killing compiler caught: " + e);			
			this.abort();
		}
	}

	killQuiet() {
	}
}