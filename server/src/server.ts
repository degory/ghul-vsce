'use strict';

import {
	TextDocuments
} from 'vscode-languageserver';

import {
	createConnection
} from 'vscode-languageserver/node'

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
import { TextDocument } from 'vscode-languageserver-textdocument';

export function log(...args: any[]) {
	// console.log(new Date() + " " + edit_queue?.state + " " + message);
	console.log(...args);
}

let problems = new ProblemStore();

let server_event_emitter = new ServerEventEmitter();
let config_event_emitter = new ConfigEventEmitter();

let connection = createConnection();

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
	edit_queue,
	response_parser	
);

response_handler.setServerManager(server_manager);
response_handler.setEditQueue(edit_queue);

export function resolveAllPendingPromises() {
	response_handler.resolveAllPendingPromises();
}

export function rejectAllPendingPromises(message: string) {
	response_handler.rejectAllPendingPromises(message);
}

export function rejectAllAndThrow(message: string) {
	log(message);
	rejectAllPendingPromises(message);
	throw message;
}

const documents = new TextDocuments(TextDocument);

documents.onDidChangeContent((change) => {
	edit_queue.queueEdit(change);
});

export const connection_event_handler = new ConnectionEventHandler(
	connection,
	server_manager,
	documents,
	config_event_emitter,
	requester,
	edit_queue,
	problems
);

export const reinitialize = () => connection_event_handler.initialize();

documents.listen(connection);
connection.listen();

