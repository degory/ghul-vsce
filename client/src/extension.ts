'use strict';

import { log } from 'console';
import * as path from 'path';

import * as vscode from 'vscode';
import { workspace, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

// The set of document URIs currently shown in some editor tab — visible,
// background, preview or pinned. Diff tabs contribute both sides.
function tabbedUris(): Set<string> {
	const uris = new Set<string>();

	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input: any = tab.input;

			if (!input) {
				continue;
			}

			if (input.uri) {
				uris.add(input.uri.toString());
			}
			if (input.modified) {
				uris.add(input.modified.toString());
			}
			if (input.original) {
				uris.add(input.original.toString());
			}
		}
	}

	return uris;
}

function hasTab(uri: vscode.Uri): boolean {
	return tabbedUris().has(uri.toString());
}

export function activate(context: ExtensionContext) {
	log("client entry point...");

	let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	// URIs whose didOpen we forwarded to the server. Only a document actually
	// shown in an editor tab is forwarded; an invisible background document
	// (e.g. one the built-in Git/Codespaces integration opens to diff a PR's
	// changed files) is not. Tracking what we forwarded keeps didChange and
	// didClose consistent — the server is never told about a document it was
	// never told to open.
	const forwarded = new Set<string>();

	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'ghul' }],
		synchronize: {
			fileEvents: [
				workspace.createFileSystemWatcher('**/.block-compiler'),
				workspace.createFileSystemWatcher('**/*.ghulproj'),
				workspace.createFileSystemWatcher('**/Directory.Build.props'),
				workspace.createFileSystemWatcher('**/Directory.Packages.props'),
				workspace.createFileSystemWatcher('**/dotnet-tools.json'),
				workspace.createFileSystemWatcher('**/*.ghul'),
			]
		},
		middleware: {
			didOpen: (document, next) => {
				const key = document.uri.toString();

				if (hasTab(document.uri)) {
					forwarded.add(key);
					return next(document);
				}

				log(`ghūl: not analysing untabbed background document ${key}`);
				return Promise.resolve();
			},
			didChange: (event, next) => {
				if (forwarded.has(event.document.uri.toString())) {
					return next(event);
				}

				return Promise.resolve();
			},
			didClose: (document, next) => {
				const key = document.uri.toString();

				if (forwarded.has(key)) {
					forwarded.delete(key);
					return next(document);
				}

				return Promise.resolve();
			}
		}
	};

	let client = new LanguageClient('ghul', 'ghūl language extension', serverOptions, clientOptions);

	// A document skipped as an untabbed background document but later opened by
	// the user (it gains a tab) must start being analysed. VS Code fires no
	// fresh didOpen for an already-open document, so drive it from the tab
	// change.
	context.subscriptions.push(
		vscode.window.tabGroups.onDidChangeTabs(() => {
			const tabbed = tabbedUris();

			for (const document of workspace.textDocuments) {
				if (document.languageId !== 'ghul') {
					continue;
				}

				const key = document.uri.toString();

				if (!forwarded.has(key) && tabbed.has(key)) {
					forwarded.add(key);

					client.sendNotification('textDocument/didOpen', {
						textDocument: {
							uri: key,
							languageId: document.languageId,
							version: document.version,
							text: document.getText()
						}
					});
				}
			}
		})
	);

	client.start().then(() => {
		log("client started...");
		context.subscriptions.push(client);
		log("client activated...");
	});
}
