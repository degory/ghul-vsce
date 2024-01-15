export {}

import { Connection } from 'vscode-languageserver';
import { ResponseHandler } from '../src/response-handler';
import { ProblemStore } from '../src/problem-store';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { GhulConfig } from '../src/ghul-config';
import { ServerManager } from '../src/server-manager';
import { EditQueue } from '../src/edit-queue';

jest.mock('../src/problem-store');
jest.mock('../src/config-event-emitter');

// describe('ResponseHandler', () => {
//     it('should be constructable', () => {
//         let connection = {} as Connection;

//         let response_handler = new ResponseHandler(
//             connection,
//             new ProblemStore(),
//             new ConfigEventEmitter()
//         );

//         expect(response_handler).toBeInstanceOf(ResponseHandler);
//     });

//     it('should just work', () => {
//         // don't care

//         expect(true).toBe(true);
//     });
//  });
 
 describe('ResponseHandler', () => {
    let connection: Connection;
    let problems: ProblemStore;
    let configEventEmitter: ConfigEventEmitter;
    let responseHandler: ResponseHandler;

    beforeEach(() => {
        connection = {} as Connection;
        problems = new ProblemStore();
        configEventEmitter = new ConfigEventEmitter();
        responseHandler = new ResponseHandler(connection, problems, configEventEmitter);
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    it('should be constructable', () => {
        expect(responseHandler).toBeInstanceOf(ResponseHandler);
    });

    it('should set want_plaintext_hover when config is available', () => {
        const config: GhulConfig = {
            compiler: '',
            source: [],
            arguments: [],
            want_plaintext_hover: true
        };
        // configEventEmitter.emit('configAvailable', 'workspace', config);

        responseHandler.onConfigAvailable('workspace', config);
        
        expect(responseHandler.want_plaintext_hover).toBe(true);
    });

    it('should remove all pending promises', () => {
        responseHandler._hover_promise_queue.enqueue();
        responseHandler._definition_promise_queue.enqueue();
        responseHandler._declaration_promise_queue.enqueue();
        responseHandler._completion_promise_queue.enqueue();
        responseHandler._signature_promise_queue.enqueue();
        responseHandler._symbols_promise_queue.enqueue();
        responseHandler._references_promise_queue.enqueue();
        responseHandler._implementation_promise_queue.enqueue();

        responseHandler.resolveAllPendingPromises();

        expect(responseHandler._hover_promise_queue.isEmpty()).toBe(true);
        expect(responseHandler._definition_promise_queue.isEmpty()).toBe(true);
        expect(responseHandler._declaration_promise_queue.isEmpty()).toBe(true);
        expect(responseHandler._completion_promise_queue.isEmpty()).toBe(true);
        expect(responseHandler._signature_promise_queue.isEmpty()).toBe(true);
        expect(responseHandler._symbols_promise_queue.isEmpty()).toBe(true);
        expect(responseHandler._references_promise_queue.isEmpty()).toBe(true);
        expect(responseHandler._implementation_promise_queue.isEmpty()).toBe(true);

    });

    it('should resolve all pending promises to null', async () => {
        let hover_promise = responseHandler._hover_promise_queue.enqueue();
        let definition_promise = responseHandler._definition_promise_queue.enqueue();
        let declaration_promise = responseHandler._declaration_promise_queue.enqueue();
        let completion_promise = responseHandler._completion_promise_queue.enqueue();
        let signature_promise = responseHandler._signature_promise_queue.enqueue();
        let symbols_promise = responseHandler._symbols_promise_queue.enqueue();
        let references_promise = responseHandler._references_promise_queue.enqueue();
        let implementation_promise = responseHandler._implementation_promise_queue.enqueue();
        let rename_promise = responseHandler._rename_promise_queue.enqueue();
        
        responseHandler.resolveAllPendingPromises();

        expect(await hover_promise).toBe(null);
        expect(await definition_promise).toBe(null);
        expect(await declaration_promise).toBe(null);
        expect(await completion_promise).toBe(null);
        expect(await signature_promise).toBe(null);
        expect(await symbols_promise).toBe(null);
        expect(await references_promise).toBe(null);
        expect(await implementation_promise).toBe(null);
        expect(await rename_promise).toBe(null);
    });

    it('should reject all pending promises', async () => {
        let hover_promise = responseHandler._hover_promise_queue.enqueue();
        let definition_promise = responseHandler._definition_promise_queue.enqueue();
        let declaration_promise = responseHandler._declaration_promise_queue.enqueue();
        let completion_promise = responseHandler._completion_promise_queue.enqueue();
        let signature_promise = responseHandler._signature_promise_queue.enqueue();
        let symbols_promise = responseHandler._symbols_promise_queue.enqueue();
        let references_promise = responseHandler._references_promise_queue.enqueue();
        let implementation_promise = responseHandler._implementation_promise_queue.enqueue();
        let rename_promise = responseHandler._rename_promise_queue.enqueue();

        const errorMessage = 'Error occurred';
        responseHandler.rejectAllPendingPromises(errorMessage);

        let results = await Promise.allSettled([
            hover_promise,
            definition_promise,
            declaration_promise,
            completion_promise,
            signature_promise,
            symbols_promise,
            references_promise,
            implementation_promise,
            rename_promise
        ]);

        results.forEach(result => { 
            expect(result.status).toBe('rejected');
            if (result.status === 'rejected') {
                expect(result.reason).toBe(errorMessage);
            }
        });
    });

    it('should set the server manager', () => {
        const serverManager: ServerManager = {} as ServerManager;
        responseHandler.setServerManager(serverManager);
        expect(responseHandler.server_manager).toBe(serverManager);
    });

    it('should set the edit queue', () => {
        const editQueue: EditQueue = {} as EditQueue;
        responseHandler.setEditQueue(editQueue);
        expect(responseHandler.edit_queue).toBe(editQueue);
    });

    it('should start listening on handleListen', () => {
        // create a mock ServerManager
        responseHandler.server_manager = {
            startListening: () => {}
        } as ServerManager;

        const startListeningSpy = jest.spyOn(responseHandler.server_manager, 'startListening');
        responseHandler.handleListen();
        expect(startListeningSpy).toHaveBeenCalled();
    });

    it('should abort server manager and show error message on handleExcept', () => {
        const abortSpy = jest.spyOn(responseHandler.server_manager, 'abort');
        const showErrorMessageSpy = jest.spyOn(responseHandler.connection.window, 'showErrorMessage');

        const errorLines = ['Error 1', 'Error 2'];
        responseHandler.handleExcept(errorLines);

        expect(abortSpy).toHaveBeenCalled();
        expect(showErrorMessageSpy).toHaveBeenCalledWith('Error 1Error 2');
    });

    it('should add diagnostics and send diagnostics on handleDiagnosticsOld', () => {
        const addDiagnosticsSpy = jest.spyOn(responseHandler, 'addDiagnostics');
        const sendDiagnosticsSpy = jest.spyOn(responseHandler.connection, 'sendDiagnostics');

        const diagnosticsLines = ['Diagnostic 1', 'Diagnostic 2'];
        responseHandler.handleDiagnosticsOld('analysis', diagnosticsLines);

        expect(addDiagnosticsSpy).toHaveBeenCalledWith('analysis', diagnosticsLines);
        expect(sendDiagnosticsSpy).toHaveBeenCalledWith(problems);
        expect(responseHandler.edit_queue.onDiagnosticsReceived).toHaveBeenCalled();
    });

    it('should send diagnostics on handleDiagnostics', () => {
        const sendDiagnosticsSpy = jest.spyOn(responseHandler.connection, 'sendDiagnostics');

        const diagnosticsLines = ['Diagnostic 1', 'Diagnostic 2'];
        responseHandler.handleDiagnostics(diagnosticsLines);

        expect(sendDiagnosticsSpy).toHaveBeenCalledWith({
            uri: 'Diagnostic 1',
            diagnostics: 'Diagnostic 2'
        });
        expect(responseHandler.edit_queue.onDiagnosticsReceived).toHaveBeenCalled();
    });

    it('should call onFullCompileDone on handleFullCompileDone', () => {
        responseHandler.handleFullCompileDone();
        expect(responseHandler.edit_queue.onFullCompileDone).toHaveBeenCalled();
    });

    it('should call onPartialCompileDone on handlePartialCompileDone', () => {
        responseHandler.handlePartialCompileDone();
        expect(responseHandler.edit_queue.onPartialCompileDone).toHaveBeenCalled();
    });

    it('should enqueue and resolve hover promise on expectHover and handleHover', async () => {
        const hoverPromise = responseHandler.expectHover();
        const hoverResolveSpy = jest.spyOn(responseHandler._hover_promise_queue, 'resolve');

        const hoverLines = ['Hover content'];
        responseHandler.handleHover(hoverLines);

        const hoverResult = await hoverPromise;
        expect(hoverResolveSpy).toHaveBeenCalledWith({
            contents: { kind: 'plaintext', value: 'Hover content' }
        });
        expect(hoverResult).toEqual({
            contents: { kind: 'plaintext', value: 'Hover content' }
        });
    });

    it('should enqueue and resolve definition promise on expectDefinition and handleDefinition', async () => {
        const definitionPromise = responseHandler.expectDefinition();
        const definitionResolveSpy = jest.spyOn(responseHandler._definition_promise_queue, 'resolve');

        const definitionLines = ['file:///path/to/file\t1\t20\t2\t30'];
        responseHandler.handleDefinition(definitionLines);

        const definitionResult = await definitionPromise;
        expect(definitionResolveSpy).toHaveBeenCalledWith({
            uri: 'file:///path/to/file',
            range: {
                start: { line: 0, character: 19 },
                end: { line: 1, character: 30 }
            }
        });
        expect(definitionResult).toEqual({
            uri: 'file:///path/to/file',
            range: {
                start: { line: 0, character: 19 },
                end: { line: 1, character: 30 }
            }
        });
    });

    it('should enqueue and resolve declaration promise on expectDeclaration and handleDeclaration', async () => {
        const declarationPromise = responseHandler.expectDeclaration();
        const declarationResolveSpy = jest.spyOn(responseHandler._declaration_promise_queue, 'resolve');

        const declarationLines = ['file:///path/to/file\t1\t20\t2\t30'];
        responseHandler.handleDeclaration(declarationLines);

        const declarationResult = await declarationPromise;
        expect(declarationResolveSpy).toHaveBeenCalledWith([
            {
                uri: 'file:///path/to/file',
                range: {
                    start: { line: 0, character: 19 },
                    end: { line: 1, character: 30 }
                }
            }
        ]);
        expect(declarationResult).toEqual([
            {
                uri: 'file:///path/to/file',
                range: {
                    start: { line: 0, character: 19 },
                    end: { line: 1, character: 30 }
                }
            }
        ]);
    });

    it('should enqueue and resolve completion promise on expectCompletion and handleCompletion', async () => {
        const completionPromise = responseHandler.expectCompletion();
        const completionResolveSpy = jest.spyOn(responseHandler._completion_promise_queue, 'resolve');

        const completionLines = ['item1\t1\tDetail 1', 'item2\t2\tDetail 2'];
        responseHandler.handleCompletion(completionLines);

        const completionResult = await completionPromise;
        expect(completionResolveSpy).toHaveBeenCalledWith([
            {
                label: 'item1',
                kind: 1,
                detail: 'Detail 1'
            },
            {
                label: 'item2',
                kind: 2,
                detail: 'Detail 2'
            }
        ]);
        expect(completionResult).toEqual([
            {
                label: 'item1',
                kind: 1,
                detail: 'Detail 1'
            },
            {
                label: 'item2',
                kind: 2,
                detail: 'Detail 2'
            }
        ]);
    });

    it('should enqueue and resolve signature promise on expectSignature and handleSignature', async () => {
        const signaturePromise = responseHandler.expectSignature();
        const signatureResolveSpy = jest.spyOn(responseHandler._signature_promise_queue, 'resolve');

        const signatureLines = ['1', '2', 'label1\tparam1\t', 'label2\tparam2\t'];
        responseHandler.handleSignature(signatureLines);

        const signatureResult = await signaturePromise;
        expect(signatureResolveSpy).toHaveBeenCalledWith({
            signatures: [
                {
                    label: 'label1',
                    parameters: [
                        { label: 'param1' }
                    ]
                },
                {
                    label: 'label2',
                    parameters: [
                        { label: 'param2' }
                    ]
                }
            ],
            activeSignature: 1,
            activeParameter: 2
        });
        expect(signatureResult).toEqual({
            signatures: [
                {
                    label: 'label1',
                    parameters: [
                        { label: 'param1' }
                    ]
                },
                {
                    label: 'label2',
                    parameters: [
                        { label: 'param2' }
                    ]
                }
            ],
            activeSignature: 1,
            activeParameter: 2
        });
    });

    it('should enqueue and resolve symbols promise on expectSymbols and handleSymbols', async () => {
        const symbolsPromise = responseHandler.expectSymbols();
        const symbolsResolveSpy = jest.spyOn(responseHandler._symbols_promise_queue, 'resolve');

        const symbolsLines = ['file:///path/to/file', 'symbol1\t1\t1\t1\t1\t1\tcontainer1', 'symbol2\t2\t2\t2\t2\t2\tcontainer2'];
        responseHandler.handleSymbols(symbolsLines);

        const symbolsResult = await symbolsPromise;
        expect(symbolsResolveSpy).toHaveBeenCalledWith([
            {
                name: 'symbol1',
                kind: 1,
                location: {
                    uri: 'file:///path/to/file',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    }
                },
                containerName: 'container1'
            },
            {
                name: 'symbol2',
                kind: 2,
                location: {
                    uri: 'file:///path/to/file',
                    range: {
                        start: { line: 1, character: 1 },
                        end: { line: 1, character: 1 }
                    }
                },
                containerName: 'container2'
            }
        ]);
        expect(symbolsResult).toEqual([
            {
                name: 'symbol1',
                kind: 1,
                location: {
                    uri: 'file:///path/to/file',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    }
                },
                containerName: 'container1'
            },
            {
                name: 'symbol2',
                kind: 2,
                location: {
                    uri: 'file:///path/to/file',
                    range: {
                        start: { line: 1, character: 1 },
                        end: { line: 1, character: 1 }
                    }
                },
                containerName: 'container2'
            }
        ]);
    });

    it('should enqueue and resolve references promise on expectReferences and handleReferences', async () => {
        const referencesPromise = responseHandler.expectReferences();
        const referencesResolveSpy = jest.spyOn(responseHandler._references_promise_queue, 'resolve');

        const referencesLines = ['file:///path/to/file\t1\t20\t2\t30'];
        responseHandler.handleReferences(referencesLines);

        const referencesResult = await referencesPromise;
        expect(referencesResolveSpy).toHaveBeenCalledWith([
            {
                uri: 'file:///path/to/file',
                range: {
                    start: { line: 0, character: 19 },
                    end: { line: 1, character: 30 }
                }
            }
        ]);
        
        expect(referencesResult).toEqual([
            {
                uri: 'file:///path/to/file',
                range: {
                    start: { line: 0, character: 19 },
                    end: { line: 1, character: 30 }
                }
            }
        ]);
    });
});