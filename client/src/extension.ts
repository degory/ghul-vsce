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
	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
	context.subscriptions.push(statusBarItem);

	// Keyed per token so two workspace folders initialising concurrently each
	// keep their own message: one folder finishing must not blank out or
	// overwrite what another still-initialising folder is reporting.
	let progressMessages = new Map<string | number, string>();

	function renderProgress() {
		if (progressMessages.size === 0) {
			statusBarItem.hide();
			return;
		}

		const [, message] = [...progressMessages].pop()!;
		statusBarItem.text = `$(sync~spin) ghūl: ${message}`;
		statusBarItem.show();
	}

	// Map iteration order is insertion order, and re-setting an existing key
	// does not move it to the end — so a token's key must be deleted before
	// it is re-set, or renderProgress keeps showing whichever token merely
	// began first instead of whichever most recently reported.
	function setProgress(token: string | number, message: string) {
		progressMessages.delete(token);
		progressMessages.set(token, message);
		renderProgress();
	}

	// The two numbers that answer "is the language support keeping up?": how
	// long the analyser takes to digest an edit, and how long a full check of
	// the project takes. Both are smoothed server-side, so this shows a
	// settled figure rather than one that jumps on every keystroke.
	let metricsBarItem = window.createStatusBarItem(StatusBarAlignment.Right);
	context.subscriptions.push(metricsBarItem);

	// Keyed per workspace folder for the same reason progress is keyed per
	// token: in a multi-root workspace each folder has its own compiler, and
	// its own latency.
	let metrics = new Map<string, AnalysisMetrics>();

	function formatDuration(milliseconds: number): string {
		return milliseconds >= 1000
			? `${(milliseconds / 1000).toFixed(1)} s`
			: `${milliseconds.toFixed(0)} ms`;
	}

	function summarise(m: AnalysisMetrics): string {
		let parts: string[] = [];

		if (m.edit_ms != null) {
			parts.push(`edit ${formatDuration(m.edit_ms)}`);
		}

		if (m.compile_ms != null) {
			parts.push(`compile ${formatDuration(m.compile_ms)}`);
		}

		return parts.join(" · ");
	}

	function renderMetrics() {
		// Map iteration order is insertion order and a re-set key does not
		// move, so the most recently *reported* folder is whichever was
		// deleted and re-added last — see setMetrics below.
		const latest = [...metrics.values()].pop();
		const summary = latest ? summarise(latest) : "";

		if (!summary) {
			metricsBarItem.hide();
			return;
		}

		metricsBarItem.text = `$(watch) ghūl: ${summary}`;
		metricsBarItem.tooltip = [...metrics.values()]
			.map(m => `${m.workspace}\nanalysis of an edit: ${m.edit_ms == null ? "—" : formatDuration(m.edit_ms)}\nfull check of the project: ${m.compile_ms == null ? "—" : formatDuration(m.compile_ms)}`)
			.join("\n\n");
		metricsBarItem.show();
	}

	function setMetrics(m: AnalysisMetrics) {
		metrics.delete(m.workspace);
		metrics.set(m.workspace, m);
		renderMetrics();
	}

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
						progressMessages.delete(token);
						renderProgress();
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
