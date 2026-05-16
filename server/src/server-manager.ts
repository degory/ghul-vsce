import { writeFileSync } from 'fs';
import { quote } from 'shell-quote';

import {
	spawn,
	ChildProcess
} from 'child_process';

import { Connection } from 'vscode-languageserver';

import { log } from './log';
import { enterWatchdogColdStart, rejectAllPendingPromises, resolveAllPendingPromises } from './extension-state';

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
	Blocked,
	// The compiler could not be started — either it was never resolved, or it
	// kept failing and we have given up retrying. We stay here, doing nothing,
	// until a fresh configuration arrives (the user edits a project file).
	Failed
}

// How many consecutive failed starts to tolerate before giving up. A healthy
// run (the compiler reaching the Listening state) resets the count, so this
// only trips when the compiler cannot start at all — a missing or broken
// .ghulproj, an unresolved compiler tool, an immediate crash.
export const MAX_RESTART_ATTEMPTS = 5;

export class ServerManager {
	child: ChildProcess;
	expecting_exit: boolean;
	expecting_recycle: boolean;

	event_emitter: ServerEventEmitter;
	connection: Connection;

	server_state: ServerState;
	ghul_config: GhulConfig;
	workspace_root: string;
	edit_queue: EditQueue;
	response_parser: ResponseParser;

	restart_attempts: number;
	restart_timer: NodeJS.Timeout;

	constructor(
		config_event_source: ConfigEventEmitter,
		event_emitter: ServerEventEmitter,
		edit_queue: EditQueue,
		response_parser: ResponseParser,
		connection?: Connection
	) {
		this.event_emitter = event_emitter;
		this.edit_queue = edit_queue;
		this.response_parser = response_parser;
		this.connection = connection;

		this.restart_attempts = 0;

		config_event_source.onConfigAvailable((workspace: string, config: GhulConfig) => {
			this.workspace_root = workspace;
			this.ghul_config = config;
			this.start();
		});
	}

	// Entry point for a fresh configuration. A new config means the user (or
	// the tooling) has changed something, so any earlier give-up is forgiven:
	// reset the back-off budget and try again from scratch.
	start() {
		this.clearRestartTimer();
		this.restart_attempts = 0;

		this.launch();
	}

	private launch() {
		this.event_emitter.starting();

		this.server_state = ServerState.StartingUp;

		let ghul_compiler = this.ghul_config.compiler;

		if (this.child) {
			log("killing running compiler PID " + this.child.pid);
			this.expecting_exit = true;

			// Stop routing the outgoing compiler's stdout into the shared
			// parser — its dying output must not bleed into the replacement's
			// frames.
			this.child.stdout?.removeAllListeners('data');
			this.child.kill();
		}

		if (this.ghul_config.block) {
			log("compiler block requested: won't spawn compiler");
			this.server_state = ServerState.Blocked;
			return;
		}

		// A retry storm cannot recover from a compiler that was never
		// resolved — spawning undefined would just throw. Surface the reason
		// and wait for a corrected configuration.
		if (!ghul_compiler || ghul_compiler.length == 0) {
			this.fail(
				"ghūl language extension: no ghūl compiler could be found. " +
				(this.ghul_config.problems?.length
					? this.ghul_config.problems.join("; ")
					: "Install the ghul.compiler tool or set 'compiler' in ghul.json.")
			);
			return;
		}

		writeFileSync(".analysis.rsp", quote(this.ghul_config.arguments));

		log(`compiler is "${quote(ghul_compiler)}"`);

		this.child = spawn(ghul_compiler[0], [...ghul_compiler.slice(1), "@.analysis.rsp"]);

		// 'error' (e.g. the compiler binary is missing) and 'exit' (the
		// compiler started then died) are both failure routes for this
		// launch. Guard so a single launch is only counted once.
		let failure_handled = false;

		const onChildFailure = (description: string) => {
			if (failure_handled) {
				return;
			}
			failure_handled = true;

			this.child = null;

			resolveAllPendingPromises();
			this.edit_queue.reset();

			log(description);

			this.scheduleRestart();
		};

		this.child.on("error", err => {
			if (this.expecting_exit) {
				log(`compiler: error after expected exit: ${err.message}`);
				return;
			}

			onChildFailure(`compiler: failed to start: ${err.message}`);
		});

		log(`spawned compiler process PID ${this.child.pid}`);

		this.child.stderr.on('data', (chunk: Buffer) => {
			process.stderr.write(chunk);
		});

		// A killed compiler can leave a half-received frame in the shared
		// parser and a watchdog timer still ticking. Clear both before the
		// replacement's output starts: a stale frame would corrupt its LISTEN
		// and leave the project unanalysed, and the calibrated timeout would
		// kill it part-way through its cold first compile.
		this.response_parser.reset();
		enterWatchdogColdStart();

		this.child.stdout.on('data', (chunk: Buffer) => {
			this.response_parser.handleChunk(chunk.toString());
		});

		this.event_emitter.running(this.child);

		const pid = this.child?.pid;

		this.child.on('exit',
			(_code: number, _signal: string) => {
				if (this.expecting_exit) {
					log(`compiler PID ${pid}: exited`);
					this.child = null;
					resolveAllPendingPromises();
					this.expecting_exit = false;
					return;
				}

				// A recycle is a planned exit — the compiler asked to be
				// restarted (RESTART frame) to shed accumulated memory. It is
				// healthy, so relaunch at once without spending the crash
				// back-off budget.
				if (this.expecting_recycle) {
					this.expecting_recycle = false;
					log(`compiler PID ${pid}: recycled — relaunching`);
					this.child = null;
					resolveAllPendingPromises();
					this.edit_queue.reset();
					this.launch();
					return;
				}

				onChildFailure(`compiler PID ${pid}: unexpected exit`);
			});
	}

	// Decide whether to try the compiler again after a failed launch, applying
	// an exponential back-off so a persistently-broken project does not turn
	// into a spawn loop (which VS Code eventually responds to by killing the
	// extension host). After MAX_RESTART_ATTEMPTS we stop and wait for a
	// configuration change.
	private scheduleRestart() {
		this.clearRestartTimer();

		this.restart_attempts++;

		if (this.restart_attempts > MAX_RESTART_ATTEMPTS) {
			this.fail(
				"ghūl language extension: the ghūl compiler failed to start repeatedly and will not be retried automatically. " +
				"Check the ghūl project file and compiler configuration — saving a project file will retry."
			);
			return;
		}

		const delay = this.restart_attempts == 1
			? 0
			: Math.min(2000 * 2 ** (this.restart_attempts - 2), 16000);

		log(`compiler: will restart (attempt ${this.restart_attempts} of ${MAX_RESTART_ATTEMPTS}) in ${delay}ms`);

		this.restart_timer = setTimeout(() => {
			this.restart_timer = null;
			this.launch();
		}, delay);
	}

	private clearRestartTimer() {
		if (this.restart_timer) {
			clearTimeout(this.restart_timer);
			this.restart_timer = null;
		}
	}

	// Stop trying and tell the user. We stay in the Failed state until a fresh
	// configuration arrives via onConfigAvailable, which resets everything.
	private fail(message: string) {
		this.clearRestartTimer();

		this.server_state = ServerState.Failed;

		log(message);

		this.connection?.window?.showErrorMessage(message);
	}

	state() {
		return this.server_state;
	}

	startListening() {
		if (this.server_state == ServerState.Blocked) {
			return;
		}

		// The compiler came up cleanly: a later crash gets a fresh retry
		// budget rather than counting against this successful run.
		this.restart_attempts = 0;

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

		this.clearRestartTimer();

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

	// The compiler announced a planned recycle with a RESTART frame and is
	// about to exit. Mark the coming exit deliberate so it relaunches cleanly
	// rather than being treated as a crash.
	noteRecycle() {
		this.expecting_recycle = true;
	}

	// The watchdog fired: the compiler has stopped answering but has not
	// exited. Kill it so the 'exit' handler routes through normal crash
	// recovery (back-off included — a wedged compiler may wedge again).
	recoverFromHang() {
		rejectAllPendingPromises("ghūl language extension: compiler watchdog timeout");

		if (this.child) {
			log(`compiler PID ${this.child.pid}: unresponsive — killing`);
			this.child.kill();
		} else {
			log("compiler watchdog timeout with no running compiler — scheduling restart");
			this.scheduleRestart();
		}
	}

	killQuiet() {
	}
}
