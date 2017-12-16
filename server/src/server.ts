'use strict';

import {
	IPCMessageReader, IPCMessageWriter, createConnection, TextDocuments
} from 'vscode-languageserver';

import { appendFileSync } from 'fs';

import { ProblemStore } from './problem-store';

import { ConnectionEventHandler } from './connection-event-handler';

import { Requester } from './requester';

import { EditQueue } from './edit-queue';

import { ServerEventEmitter } from './server-event-emitter';

import { ResponseHandler } from './response-handler';

import { ResponseParser } from './response-parser';

import { ConfigEventEmitter } from './config-event-emitter';

import { GhulAnalyser } from './ghul-analyser';

import { ServerManager } from './server-manager';

export function log(message: string) {
	console.log(message);

	// 2017-12-16T12:24:20.226Z
	// 012345678901234567890123
	//           11111111112222

	let date_string = new Date().toISOString();

	let log_date_string =
		date_string.substring(0, 10) +
		' ' +
		date_string.substring(11, 22);

	appendFileSync("log.txt", log_date_string + ": " + message + "\n");
}

let problems = new ProblemStore();

let server_event_emitter = new ServerEventEmitter();
let config_event_emitter = new ConfigEventEmitter();

let connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

let response_handler = new ResponseHandler(
	connection,
	problems,
);

let requester = new Requester(server_event_emitter, response_handler);

let edit_queue = new EditQueue(requester, problems);

new GhulAnalyser(
	requester,
	config_event_emitter,
	server_event_emitter
);

let response_parser = new ResponseParser(response_handler);

let server_manager = new ServerManager(
	config_event_emitter,
	server_event_emitter,
	response_parser	
);

response_handler.setServerManager(server_manager);
response_handler.setEditQueue(edit_queue);

let documents: TextDocuments = new TextDocuments();
 
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	log("XXX onDidChangeDocument: " + change.document.uri);

	log("doc version: " + change.document.version)

	// TODO: if not listening then needs to be queued, but must be
	// queued after initial whole workspace analyis. Otherwise server
	// will attempt to analyse just this file, without the rest 
	// of the workspace, and will crash due to missing Ghul namespace

	edit_queue.queueEdit(change);
});

new ConnectionEventHandler(
	connection,
	server_manager,
	documents,
	config_event_emitter,
	requester,
	edit_queue
);


documents.listen(connection);
connection.listen();

