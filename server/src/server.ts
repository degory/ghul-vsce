'use strict';

import {
	IPCMessageReader, IPCMessageWriter, createConnection, TextDocuments
} from 'vscode-languageserver';

// import { appendFileSync } from 'fs';

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

let real_console_log = console.log;

export function log(message: string) {
	real_console_log(message);

	// 2017-12-16T12:24:20.226Z
	// 012345678901234567890123
	//           11111111112222

	/*
	let date_string = new Date().toISOString();

	let log_date_string =
		date_string.substring(0, 10) +
		' ' +
		date_string.substring(11, 22);

	appendFileSync("log.txt", log_date_string + ": " + message + "\n");
	*/
}

console.log = log;

let problems = new ProblemStore();

let server_event_emitter = new ServerEventEmitter();
let config_event_emitter = new ConfigEventEmitter();

let connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

let response_handler = new ResponseHandler(
	connection,
	problems,
	config_event_emitter
);

let requester = new Requester(server_event_emitter, response_handler);

let edit_queue = new EditQueue(requester, problems);

new GhulAnalyser(
	edit_queue,
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

export function rejectAllPendingPromises(message: string) {
	response_handler.rejectAllPendingPromises(message);
}

export function rejectAllAndThrow(message: string) {
	log(message);
	rejectAllPendingPromises(message);
	throw message;
}

let documents: TextDocuments = new TextDocuments();
 
documents.onDidChangeContent((change) => {
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

