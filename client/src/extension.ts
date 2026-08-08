'use strict';

import { log } from 'console';
import * as path from 'path';

import { ExtensionContext, StatusBarAlignment, window } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

// Mirrors the payload of the server's ghul/metrics notification
// (server/src/metrics-reporter.ts). Durations are in milliseconds, and null
// until the analyser has completed one of that kind of run.
interface AnalysisMetrics {
	workspace: string;
	edit_ms: number | null;
	compile_ms: number | null;
}

export function activate(context: ExtensionContext) {
	log("client entry point...")

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	// The debug options for the server
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run : { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	}

	// vscode-languageclient renders workDoneProgress at ProgressLocation.Window
	// by default, which VS Code shows as an easy-to-miss status bar sliver (the
	// library's own source calls it "a silent window progress with a hidden
	// notification"). The workspace setup this reports on can take the better
	// part of a minute on a fresh checkout, so surface it ourselves via a
	// dedicated status bar item instead.
	//
	// One item carries everything ghūl has to say. It is always the logo and a
	// state glyph — a spinner while the analyser is working, a ring while it
	// is not — with a message between them for the few activities that owe the
	// user an explanation rather than a spinner. Routine analysis reports no
	// words at all, so the item stays one fixed width through everything the
	// user does to it while typing; the analyser timings live in the tooltip
	// rather than taking permanent width. The extension only activates on a
	// workspace containing ghūl files, so the item is meaningful wherever it
	// appears and never needs to be hidden.
	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right);
	context.subscriptions.push(statusBarItem);

	// How long a finished activity stays on screen. Work that takes a moment
	// and then vanishes the instant it lands is not readable — the message is
	// gone before it can be taken in, and the status bar reads as flickering
	// rather than as reporting. Long enough to read a few words, short enough
	// not to still be claiming something is happening when it isn't.
	const COMPLETED_HOLD_MS = 1500;

	// Trails whatever else the item is showing rather than leading it: the logo
	// is what identifies the item, so it keeps the front, and the state glyph
	// reads as attached to the activity it belongs to.
	const RUNNING_ICON = '$(sync~spin)';

	// Stands in the same cell as RUNNING_ICON when nothing is running.
	// Codicons share a glyph box, so swapping one for the other never resizes
	// the item, and nothing else in the status bar is pushed aside while the
	// analyser works. An open ring reads as at rest, where a static $(sync)
	// would read as a spinner that had seized.
	const IDLE_ICON = '$(circle-large-outline)';

	// Contributed in package.json from images/ghul-icons.woff. It stands where
	// the word "ghūl" used to, so the item says who is reporting without
	// spending width on it, and it takes the status bar foreground colour the
	// same way the codicons beside it do.
	const BRAND_ICON = '$(ghul-logo)';

	// The one phrase the server uses for all of its routine analysis — an edit
	// being digested, the full check after a lull, a slow query. It stands for
	// "the analyser is busy" and nothing more, so it is shown as the spinner
	// alone: the words would appear and vanish several times a minute while
	// drawing a distinction nobody asked to follow. Every other message names
	// something rarer that leaves the editor degraded while it runs, and is
	// shown as it stands.
	//
	// Kept in step with ROUTINE_ANALYSIS_MESSAGE in
	// server/src/activity-progress.ts, which explains why it is a word rather
	// than a marker.
	const ROUTINE_ANALYSIS_MESSAGE = 'analysing';

	interface ProgressEntry {
		message: string;
		// Set once the activity has finished and the message is only being
		// held on screen to be read.
		completed: boolean;
	}

	// Keyed per token so two workspace folders initialising concurrently each
	// keep their own message: one folder finishing must not blank out or
	// overwrite what another still-initialising folder is reporting.
	let progressMessages = new Map<string | number, ProgressEntry>();
	let holdTimers = new Map<string | number, NodeJS.Timeout>();

	function render() {
		const entries = [...progressMessages.values()];

		// Anything still running spins, whatever it is — including routine
		// analysis, which contributes the spinner without contributing words.
		const running = entries.some(entry => !entry.completed);

		// Of the activities that do have something to say, the most recent
		// one says it.
		const explained = entries.filter(entry => entry.message != ROUTINE_ANALYSIS_MESSAGE);
		const entry = explained[explained.length - 1];

		statusBarItem.text =
			`${BRAND_ICON}${entry ? ` ${entry.message}` : ''} ${running ? RUNNING_ICON : IDLE_ICON}`;

		statusBarItem.tooltip = describeMetrics();
		statusBarItem.show();
	}

	function clearHold(token: string | number) {
		const timer = holdTimers.get(token);

		if (timer) {
			clearTimeout(timer);
			holdTimers.delete(token);
		}
	}

	// Map iteration order is insertion order, and re-setting an existing key
	// does not move it to the end — so a token's key must be deleted before
	// it is re-set, or render keeps showing whichever token merely began first
	// instead of whichever most recently reported.
	function setProgress(token: string | number, message: string) {
		clearHold(token);
		progressMessages.delete(token);
		progressMessages.set(token, { message, completed: false });
		render();
	}

	// The activity is over. Whatever it last said stays up, in the past tense
	// the server switched it to, with the spinner stopped — then the item falls
	// back to the logo and the idle ring. More work arriving in the meantime
	// takes the display back immediately, via setProgress above; there is no
	// wait to get through before the next thing can be reported.
	function finishProgress(token: string | number) {
		const entry = progressMessages.get(token);

		if (!entry) {
			return;
		}

		// Routine analysis put no words on screen, so it has none to leave
		// there — and it ends often enough that holding a timer open for each
		// one would be a timer per keystroke burst for nothing to read.
		if (entry.message == ROUTINE_ANALYSIS_MESSAGE) {
			clearHold(token);
			progressMessages.delete(token);
			render();

			return;
		}

		entry.completed = true;
		render();

		clearHold(token);
		holdTimers.set(token, setTimeout(() => {
			holdTimers.delete(token);
			progressMessages.delete(token);
			render();
		}, COMPLETED_HOLD_MS));
	}

	// The two numbers that answer "is the language support keeping up?": how
	// long the analyser takes to digest an edit, and how long a full check of
	// the project takes. Both are smoothed server-side, so these are settled
	// figures rather than ones that jump on every keystroke. They live in the
	// tooltip: worth having to hand, not worth standing width in the bar for.
	//
	// Keyed per workspace folder for the same reason progress is keyed per
	// token: in a multi-root workspace each folder has its own compiler, and
	// its own latency.
	let metrics = new Map<string, AnalysisMetrics>();

	function formatDuration(milliseconds: number): string {
		return milliseconds >= 1000
			? `${(milliseconds / 1000).toFixed(1)} s`
			: `${milliseconds.toFixed(0)} ms`;
	}

	function describeMetrics(): string {
		if (metrics.size === 0) {
			return "ghūl language support";
		}

		return [...metrics.values()]
			.map(m => `${m.workspace}\nedit analysis: ${m.edit_ms == null ? "—" : formatDuration(m.edit_ms)}\nfull analysis: ${m.compile_ms == null ? "—" : formatDuration(m.compile_ms)}`)
			.join("\n\n");
	}

	function setMetrics(m: AnalysisMetrics) {
		metrics.delete(m.workspace);
		metrics.set(m.workspace, m);
		render();
	}

	// Put the item up before the server has said anything. Activation already
	// means this workspace contains ghūl code, and an item that only appeared
	// once the first activity happened to arrive would read as ghūl support
	// coming and going.
	render();

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for ghul source files
		documentSelector: [{scheme: 'file', language: 'ghul'}],

		// File watching is not configured here: the server registers the
		// patterns it cares about itself, via workspace/didChangeWatchedFiles,
		// so that every client watches the same set. Declaring them here too
		// would deliver each change twice.

		middleware: {
			// Deliberately not calling `next(token, params)` here: doing so hands
			// the same notification to vscode-languageclient's own default
			// handler, which renders it a second time via the built-in
			// ProgressLocation.Window UI described above — a second, differently
			// styled spinner showing identical text next to this one.
			handleWorkDoneProgress: (token, params, _next) => {
				switch (params.kind) {
					// A blank message means the token was granted after the
					// work it was for had already finished. It has to be begun
					// before it can be ended, so it arrives as an immediate
					// begin/end pair with nothing to say — rendering it would
					// flash an empty label in the status bar.
					case 'begin':
						if (params.message) {
							setProgress(token, params.message);
						}
						break;
					case 'report':
						if (params.message) {
							setProgress(token, params.message);
						}
						break;
					case 'end':
						finishProgress(token);
						break;
				}
			}
		}
	}
	
	// Create the language client and start the client.
	let client = new LanguageClient('ghul', 'ghūl language extension', serverOptions, clientOptions);

	client.start().then(() => {
		log("client started...");

		context.subscriptions.push(
			client.onNotification('ghul/metrics', (m: AnalysisMetrics) => setMetrics(m))
		);

		// Push the disposable to the context's subscriptions so that the 
		// client can be deactivated on extension deactivation
		context.subscriptions.push(client);
	
		log("client activated...");	
	});
}
