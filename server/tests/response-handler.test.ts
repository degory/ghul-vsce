export {}

import { createMock } from 'ts-auto-mock';
import { Connection } from 'vscode-languageserver';
import { ResponseHandler } from '../src/response-handler';
import { ProblemStore } from '../src/problem-store';
import { ConfigEventEmitter } from '../src/config-event-emitter';


describe('ResponseHandler', () => {
    let mockConnection: Connection;
    let problemStore: ProblemStore;
    let mockConfigEventEmitter: ConfigEventEmitter;

    beforeEach(() => {
        mockConnection = createMock<Connection>();
        problemStore = new ProblemStore()
        mockConfigEventEmitter = createMock<ConfigEventEmitter>();
    });

    it('should just work', () => {
        // don't care

        expect(true).toBe(true);
    });

    it('should be constructable', () => {
        let responseHandler = new ResponseHandler(mockConnection, problemStore, mockConfigEventEmitter);

        expect(responseHandler).toBeDefined();
    });
 });