'use strict';

import { log } from 'console';
import * as path from 'path';

import { ExtensionContext, StatusBarAlignment, window } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

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

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for ghul source files
		documentSelector: [{scheme: 'file', language: 'ghul'}],

		// File watching is not configured here: the server registers the
		// patterns it cares about itself, via workspace/didChangeWatchedFiles,
		// so that every client watches the same set. Declaring them here too
		// would deliver each change twice.

		middleware: {
			// Deliberately does not call `next(token, params)`: doing so hands
			// the same event to vscode-languageclient's own default handler,
			// which renders it a second time as the "hidden" window-progress
			// notification referenced above. That duplicate was easy to miss
			// in desktop VS Code but shows up as a second, differently-styled
			// spinner with identical text in the Codespaces status bar.
			handleWorkDoneProgress: (token, params, _next) => {
				switch (params.kind) {
					case 'begin':
						setProgress(token, params.message ?? params.title);
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
	
		// Push the disposable to the context's subscriptions so that the 
		// client can be deactivated on extension deactivation
		context.subscriptions.push(client);
	
		log("client activated...");	
	});
}
