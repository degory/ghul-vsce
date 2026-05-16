export {}

import { Connection } from 'vscode-languageserver';
import { ResponseHandler } from '../src/response-handler';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { GhulConfig } from '../src/ghul-config';
import { ServerManager } from '../src/server-manager';
import { EditQueue } from '../src/edit-queue';

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
    let configEventEmitter: ConfigEventEmitter;
    let responseHandler: ResponseHandler;

    beforeEach(() => {
        connection = {} as Connection;
        configEventEmitter = new ConfigEventEmitter();
        responseHandler = new ResponseHandler(connection, configEventEmitter);
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    it('should be constructable', () => {
        expect(responseHandler).toBeInstanceOf(ResponseHandler);
    });

    it('should set want_plaintext_hover when config is available', () => {
        const config: GhulConfig = {
            block: false,
            compiler: [''],
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

    it('should resolve all pending promises to no result', async () => {
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
        expect(await definition_promise).toEqual([]);
        expect(await declaration_promise).toEqual([]);
        expect(await completion_promise).toEqual([]);
        expect(await signature_promise).toBe(null);
        expect(await symbols_promise).toEqual([]);
        expect(await references_promise).toEqual([]);
        expect(await implementation_promise).toEqual([]);
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

    it('should send diagnostics on handleDiagnostics', () => {
        responseHandler.connection = {
            sendDiagnostics: () => {}
        } as any;

        responseHandler.edit_queue = {
            onDiagnosticsReceived: () => {}
        } as any;

        const onDiagnosticsReceivedSpy = jest.spyOn(responseHandler.edit_queue, 'onDiagnosticsReceived');

        const sendDiagnosticsSpy = jest.spyOn(responseHandler.connection, 'sendDiagnostics');

        /*
{               uri: fields[0],
                severity: SeverityMapper.getSeverity(fields[5], "new"),
                range: {
                    start: { line: Number(fields[1]) - 1, character: Number(fields[2]) - 1 },
                    end: { line: Number(fields[3]) - 1, character: Number(fields[4]) - 1 }
                },
                message: fields[6],
                source: 'ghūl'
            }

        */

        let diagnostics = [
            ["file://test.ghul", 1, 20, 2, 30, 1, 'Diagnostic 1'],
            ["file://test.ghul", 1, 20, 2, 30, 2, 'Diagnostic 2'],    
            ["file://test.ghul", 1, 20, 2, 30, 3, 'Diagnostic 3'],    
            ["file://test.ghul", 1, 20, 2, 30, 4, 'Diagnostic 4'],    
        ];

        const diagnosticsLines = diagnostics.map(d => d.join('\t'));

        responseHandler.handleDiagnostics(diagnosticsLines);

        expect(sendDiagnosticsSpy).toHaveBeenCalledWith({
            uri: 'file://test.ghul/',
            diagnostics: [
                {
                    severity: 1,
                    range: {
                        start: { line: 0, character: 19 },
                        end: { line: 1, character: 29 }
                    },
                    message: 'Diagnostic 1',
                    source: 'ghūl'
                },
                {
                    severity: 2,
                    range: {
                        start: { line: 0, character: 19 },
                        end: { line: 1, character: 29 }
                    },
                    message: 'Diagnostic 2',
                    source: 'ghūl'
                },
                {
                    severity: 3,
                    range: {
                        start: { line: 0, character: 19 },
                        end: { line: 1, character: 29 }
                    },
                    message: 'Diagnostic 3',
                    source: 'ghūl'
                },
                {
                    severity: 4,
                    range: {
                        start: { line: 0, character: 19 },
                        end: { line: 1, character: 29 }
                    },
                    message: 'Diagnostic 4',
                    source: 'ghūl'
                }
            ]
        });

        expect(onDiagnosticsReceivedSpy).toHaveBeenCalled();
    });

    it('should call onFullCompileDone on handleFullCompileDone', () => {
        responseHandler.edit_queue = {
            onFullCompileDone: () => {}
        } as any;

        const onFullCompileDoneSpy = jest.spyOn(responseHandler.edit_queue, 'onFullCompileDone');

        responseHandler.handleFullCompileDone(["1000"]);
        expect(onFullCompileDoneSpy).toHaveBeenCalled();
    });

    it('should call onPartialCompileDone on handlePartialCompileDone', () => {
        responseHandler.edit_queue = {
            onPartialCompileDone: () => {}
        } as any;

        const onPartialCompileDoneSpy = jest.spyOn(responseHandler.edit_queue, 'onPartialCompileDone');

        responseHandler.handlePartialCompileDone(["1000"]);
        expect(onPartialCompileDoneSpy).toHaveBeenCalled();
    });

    it('should enqueue and resolve hover promise on expectHover and handleHover', async () => {
        const hoverPromise = responseHandler.expectHover();
        // const hoverResolveSpy = jest.spyOn(responseHandler._hover_promise_queue, 'resolve');

        const hoverLines = ['Hover content'];
        responseHandler.handleHover(hoverLines);

        const hoverResult = await hoverPromise;

        // expect(hoverResolveSpy).toHaveBeenCalledWith({
        //     contents: { kind: 'plaintext', value: 'Hover content' }
        // });

        expect(hoverResult).toEqual({
            contents: { language: 'ghul', value: 'Hover content' }
        });
    });

    it('should enqueue and resolve definition promise on expectDefinition and handleDefinition', async () => {
        const definitionPromise = responseHandler.expectDefinition();
        // const definitionResolveSpy = jest.spyOn(responseHandler._definition_promise_queue, 'resolve');

        const definitionLines = ['file:///path/to/file\t1\t20\t2\t30'];
        responseHandler.handleDefinition(definitionLines);

        const definitionResult = await definitionPromise;

        // expect(definitionResult).resolves.toEqual({
        //     uri: 'file:///path/to/file',
        //     range: {
        //         start: { line: 0, character: 19 },
        //         end: { line: 1, character: 30 }
        //     }
        // });

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
        // const declarationResolveSpy = jest.spyOn(responseHandler._declaration_promise_queue, 'resolve');

        const declarationLines = ['file:///path/to/file\t1\t20\t2\t30'];
        responseHandler.handleDeclaration(declarationLines);

        const declarationResult = await declarationPromise;

        // expect(declarationResolveSpy).toHaveBeenCalledWith([
        //     {
        //         uri: 'file:///path/to/file',
        //         range: {
        //             start: { line: 0, character: 19 },
        //             end: { line: 1, character: 30 }
        //         }
        //     }
        // ]);

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
        // const completionResolveSpy = jest.spyOn(responseHandler._completion_promise_queue, 'resolve');

        const completionLines = ['item1\t1\tDetail 1', 'item2\t2\tDetail 2'];
        responseHandler.handleCompletion(completionLines);

        const completionResult = await completionPromise;

        // expect(completionResolveSpy).toHaveBeenCalledWith([
        //     {
        //         label: 'item1',
        //         kind: 1,
        //         detail: 'Detail 1'
        //     },
        //     {
        //         label: 'item2',
        //         kind: 2,
        //         detail: 'Detail 2'
        //     }
        // ]);

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

        const signatureLines = [
            '1', 
            '2', 
            'function1\tf1 param1\tf1 param2\tf1 param3', 
            'function2\tf2 param1\tf2 param2\tf2 param3'
        ];

        responseHandler.handleSignature(signatureLines);

        const signatureResult = await signaturePromise;

        expect(signatureResult).toEqual({
            signatures: [
                {
                    label: 'function1',
                    parameters: [
                        { label: 'f1 param1' },
                        { label: 'f1 param2' },
                        { label: 'f1 param3' }
                    ]
                },
                {
                    label: 'function2',
                    parameters: [
                        { label: 'f2 param1' },
                        { label: 'f2 param2' },
                        { label: 'f2 param3' }
                    ]
                }
            ],
            activeSignature: 1,
            activeParameter: 2
        });
    });

    it('should enqueue and resolve symbols promise on expectSymbols and handleSymbols', async () => {
        const symbolsPromise = responseHandler.expectSymbols();
        // const symbolsResolveSpy = jest.spyOn(responseHandler._symbols_promise_queue, 'resolve');

        const symbolsLines = [ 'file:///path/to/file', 'symbol1\t1\t1\t1\t1\t1\tcontainer1', 'symbol2\t2\t2\t2\t2\t2\tcontainer2'];
        responseHandler.handleSymbols(symbolsLines);

        const symbolsResult = await symbolsPromise;

        // expect(symbolsResolveSpy).toHaveBeenCalledWith([
        //     {
        //         name: 'symbol1',
        //         kind: 1,
        //         location: {
        //             uri: 'file:///path/to/file',
        //             range: {
        //                 start: { line: 0, character: 0 },
        //                 end: { line: 0, character: 0 }
        //             }
        //         },
        //         containerName: 'container1'
        //     },
        //     {
        //         name: 'symbol2',
        //         kind: 2,
        //         location: {
        //             uri: 'file:///path/to/file',
        //             range: {
        //                 start: { line: 1, character: 1 },
        //                 end: { line: 1, character: 1 }
        //             }
        //         },
        //         containerName: 'container2'
        //     }
        // ]);

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
        // const referencesResolveSpy = jest.spyOn(responseHandler._references_promise_queue, 'resolve');

        const referencesLines = ['file:///path/to/file\t1\t20\t2\t30'];
        responseHandler.handleReferences(referencesLines);

        const referencesResult = await referencesPromise;

        // expect(referencesResolveSpy).toHaveBeenCalledWith([
        //     {
        //         uri: 'file:///path/to/file',
        //         range: {
        //             start: { line: 0, character: 19 },
        //             end: { line: 1, character: 30 }
        //         }
        //     }
        // ]);
        
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

    it('handleImplementation parses location lines like handleReferences', async () => {
        const p = responseHandler.expectImplementation();
        responseHandler.handleImplementation([
            'file:///a.ghul\t1\t1\t1\t10',
            'file:///b.ghul\t2\t1\t2\t5',
        ]);

        await expect(p).resolves.toEqual([
            { uri: 'file:///a.ghul', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
            { uri: 'file:///b.ghul', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } },
        ]);
    });

    it('handleRenameRequest groups edits by uri', async () => {
        const p = responseHandler.expectRenameRequest();
        responseHandler.handleRenameRequest([
            'file:///a.ghul\t1\t1\t1\t5\tnewA1',
            'file:///a.ghul\t2\t1\t2\t5\tnewA2',
            'file:///b.ghul\t1\t1\t1\t5\tnewB',
        ]);

        const result = await p;
        expect(result.changes!['file:///a.ghul']).toHaveLength(2);
        expect(result.changes!['file:///b.ghul']).toHaveLength(1);
        expect(result.changes!['file:///b.ghul']![0].newText).toBe('newB');
    });

    it('handleRenameRequest resolves with an empty changes object when given no lines', async () => {
        const p = responseHandler.expectRenameRequest();
        responseHandler.handleRenameRequest([]);

        await expect(p).resolves.toEqual({ changes: {} });
    });

    it('handleHover returns plaintext when want_plaintext_hover is set', async () => {
        responseHandler.want_plaintext_hover = true;
        const p = responseHandler.expectHover();

        responseHandler.handleHover(['some hover text']);

        await expect(p).resolves.toEqual({
            contents: { kind: 'plaintext', value: 'some hover text' },
        });
    });

    it('handleHover resolves to null on empty lines', async () => {
        const p = responseHandler.expectHover();

        responseHandler.handleHover([]);

        await expect(p).resolves.toBeNull();
    });

    it('handleDefinition resolves to null when no lines are given', async () => {
        const p = responseHandler.expectDefinition();

        responseHandler.handleDefinition([]);

        await expect(p).resolves.toBeNull();
    });

    it('handleDeclaration resolves to [] when no lines are given', async () => {
        const p = responseHandler.expectDeclaration();

        responseHandler.handleDeclaration([]);

        await expect(p).resolves.toEqual([]);
    });

    it('handleCompletion drops lines without enough fields', async () => {
        const p = responseHandler.expectCompletion();

        responseHandler.handleCompletion([
            'ok-item\t5\tDetail',  // valid
            'too-few-fields',       // invalid – dropped
            '',                     // invalid – dropped
        ]);

        await expect(p).resolves.toEqual([
            { label: 'ok-item', kind: 5, detail: 'Detail' },
        ]);
    });

    it('handleSymbols filters out internal/reflected sentinel uris', async () => {
        const p = responseHandler.expectSymbols();

        responseHandler.handleSymbols([
            'internal',
            'symbolA\t1\t1\t1\t1\t1\tcontainer',
            'reflected',
            'symbolB\t1\t1\t1\t1\t1\tcontainer',
            'file:///real.ghul',
            'symbolC\t1\t1\t1\t1\t1\tcontainer',
        ]);

        const result = await p;
        expect(result.find(s => s.location.uri === 'internal')).toBeUndefined();
        expect(result.find(s => s.location.uri === 'reflected')).toBeUndefined();
        expect(result.map(s => s.name).sort()).toEqual(['symbolC']);
    });

    it('handleSymbols filters out entries with negative line/character coordinates', async () => {
        const p = responseHandler.expectSymbols();

        responseHandler.handleSymbols([
            'file:///a.ghul',
            'bad\t1\t-1\t1\t1\t1\tcontainer',
            'good\t1\t1\t1\t1\t1\tcontainer',
        ]);

        const result = await p;
        expect(result.map(s => s.name)).toEqual(['good']);
    });

    it('handleSignature handles negative active_signature by leaving it undefined', async () => {
        const p = responseHandler.expectSignature();

        responseHandler.handleSignature(['-1', '0', 'fn\tparam']);

        const result = await p;
        expect(result.activeSignature).toBeUndefined();
        expect(result.activeParameter).toBe(0);
        expect(result.signatures).toHaveLength(1);
    });

    it('handleSignature returns an empty signature set when given no lines', async () => {
        const p = responseHandler.expectSignature();

        responseHandler.handleSignature([]);

        const result = await p;
        expect(result.signatures).toEqual([]);
    });

    it('handleRestart notes the recycle and resets the edit queue', () => {
        const reset = jest.fn();
        const noteRecycle = jest.fn();
        responseHandler.edit_queue = { reset } as any;
        responseHandler.server_manager = { noteRecycle } as any;

        responseHandler.handleRestart();

        expect(noteRecycle).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('handleUnexpected calls server_manager.abort', () => {
        const abort = jest.fn();
        responseHandler.server_manager = { abort } as any;

        responseHandler.handleUnexpected();

        expect(abort).toHaveBeenCalledTimes(1);
    });

    it('setServerManager throws on a second assignment', () => {
        // First assignment is OK; second goes through rejectAllAndThrow.
        // We rely on a singleton response_handler being present (set up by
        // an earlier test) so rejectAllAndThrow doesn't NPE before throwing.
        // setEditQueue follows the same shape.
        const ExtensionState = require('../src/extension-state').ExtensionState;
        ExtensionState.getInstance().response_handler = responseHandler;

        responseHandler.server_manager = { startListening: jest.fn() } as any;

        expect(() => responseHandler.setServerManager({} as any)).toThrow();
    });

    it('setEditQueue throws on a second assignment', () => {
        const ExtensionState = require('../src/extension-state').ExtensionState;
        ExtensionState.getInstance().response_handler = responseHandler;

        responseHandler.edit_queue = { reset: jest.fn() } as any;

        expect(() => responseHandler.setEditQueue({} as any)).toThrow();
    });

    it('parseDiagnostics tolerates non-file uri prefixes and adds file://', () => {
        const result = responseHandler.parseDiagnostics([
            '/abs/path/x.ghul\t1\t1\t1\t5\t1\tmessage',
        ]);
        const uris = Array.from(result.keys());
        expect(uris[0].startsWith('file://')).toBe(true);
    });

    it('parseDiagnostics drops internal and reflected lines', () => {
        const result = responseHandler.parseDiagnostics([
            'internal\t1\t1\t1\t5\t1\tmsg',
            'reflected\t1\t1\t1\t5\t1\tmsg',
            'file:///real.ghul\t1\t1\t1\t5\t1\tmsg',
        ]);
        const uris = Array.from(result.keys());
        expect(uris).toEqual(['file:///real.ghul']);
    });
});