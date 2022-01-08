'use strict';

import * as path from 'path';

import { workspace, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

export function activate(context: ExtensionContext) {
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
	
	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for ghul source files
		documentSelector: [{scheme: 'file', language: 'ghul'}],
		synchronize: {
			// Notify the server about file changes to '.ghul' and '.ghulproj' files contain in the workspace
			fileEvents: [
				workspace.createFileSystemWatcher('**/*.ghul'),
				workspace.createFileSystemWatcher('**/*.ghulproj')
			]
		}
	}
	
	// Create the language client and start the client.
	let disposable = new LanguageClient('ghul', 'ghūl language extension', serverOptions, clientOptions).start();
	
	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation
	context.subscriptions.push(disposable);
}
