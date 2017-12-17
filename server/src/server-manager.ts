import {
	spawn,
	spawnSync,
	ChildProcess
} from 'child_process';

import { log, rejectAllAndThrow } from './server';

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
		if (this.ghul_config.use_docker) {
			this.killQuiet();
		}

		this.event_emitter.starting();

		this.server_state = ServerState.StartingUp;
	
		let ghul_compiler = this.ghul_config.ghul_compiler ? this.ghul_config.ghul_compiler : "./ghul";
		
		if (this.ghul_config.use_docker) {
			log("starting ghūl compiler '" + ghul_compiler + "' in container");
			this.child = spawn("docker", [
				"run", "--name", "ghul-analyse",
				"--rm",
				"-v", this.workspace_root + ":/home/dev/source",
				"-w", "/home/dev/source",
				"-i", "ghul/compiler:stable",
				ghul_compiler, "-A"
			]);
		} else {
			log("starting ghūl compiler '" + ghul_compiler + "'");
			this.child = spawn(ghul_compiler, [ "-A" ]);
		} 

		this.event_emitter.running(this.child);
	
		this.child.stderr.on('data', (chunk: string) => {
			log('' + chunk);
		});
	
		this.child.stdout.on('data', (chunk: string) => {
			this.response_parser.handleChunk(chunk);
		});
	
		this.child.on('exit',
			(_code: number, _signal: string) => {
				log("ghūl compiler exited - you will need to restart your IDE");
	
				this.abort();

				rejectAllAndThrow("ghūl compiler exited unexpectedly");
			}
		);
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

		log("kill any running ghūl compiler container...");
		try {
			spawnSync("docker",
				[
					"rm", "-f", "ghul-analyse",
				]
			);
	
			this.event_emitter.killed();
		} catch (e) {
			log("something went wrong killing ghūl compiler container: " + e);			
			this.abort();
		}
	}

	killQuiet() {
		try {
			spawnSync("docker",
				[
					"rm", "-f", "ghul-analyse",
				]
			);
		} catch (e) {
			log("something went wrong killing ghūl compiler container: " + e);			
		}
	}
}