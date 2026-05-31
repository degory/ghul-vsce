import {
    CompletionParams,
    Connection,
    DocumentSymbolParams,
    ReferenceParams,
    TextDocumentPositionParams,
    TextDocuments,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { ConnectionEventHandler } from '../src/connection-event-handler';
import { ExtensionState } from '../src/extension-state';
import { WorkspaceContext } from '../src/workspace-context';
import { Requester } from '../src/requester';
import { EditQueue } from '../src/edit-queue';
import { SEMANTIC_TOKENS_LEGEND } from '../src/response-handler';

// ConnectionEventHandler is the thin router between the LSP Connection and
// the per-workspace state held by each WorkspaceContext. Most of the work
// happens in WorkspaceContext / WorkspaceContext.initialize, covered in
// workspace-context.test.ts; here we pin (1) that every connection.onX hook
// is registered, (2) that per-URI requests are dispatched to the workspace
// the URI belongs to, and (3) that requests with no owning workspace come
// back with an empty result rather than blowing up.

const hooks = [
    'onInitialize',
    'onShutdown',
    'onExit',
    'onDidChangeConfiguration',
    'onDidChangeWatchedFiles',
    'onCompletion',
    'onHover',
    'onDefinition',
    'onDeclaration',
    'onSignatureHelp',
    'onDocumentSymbol',
    'onWorkspaceSymbol',
    'onReferences',
    'onImplementation',
    'onTypeDefinition',
    'onRenameRequest',
    'onDocumentFormatting',
    'onDocumentRangeFormatting',
] as const;

function makeMockConnection(): Connection {
    const conn: any = {};
    for (const h of hooks) {
        conn[h] = jest.fn();
    }
    conn.languages = { semanticTokens: { on: jest.fn() } };
    conn.window = {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
    };
    return conn as Connection;
}

function makeMockRequester(): Requester {
    return {
        sendCompletion: jest.fn().mockResolvedValue([]),
        sendHover: jest.fn().mockResolvedValue(null),
        sendDefinition: jest.fn().mockResolvedValue([]),
        sendDeclaration: jest.fn().mockResolvedValue([]),
        sendSignature: jest.fn().mockResolvedValue(null),
        sendDocumentSymbol: jest.fn().mockResolvedValue([]),
        sendWorkspaceSymbol: jest.fn().mockResolvedValue([]),
        sendReferences: jest.fn().mockResolvedValue([]),
        sendImplementation: jest.fn().mockResolvedValue([]),
        sendTypeDefinition: jest.fn().mockResolvedValue(null),
        sendRenameRequest: jest.fn().mockResolvedValue(null),
        sendSemanticTokens: jest.fn().mockResolvedValue({ data: [] }),
        sendDocumentFormatting: jest.fn().mockResolvedValue([]),
        sendDocumentRangeFormatting: jest.fn().mockResolvedValue([]),
    } as unknown as Requester;
}

function makeMockEditQueue(): EditQueue {
    return {
        sendQueued: jest.fn(),
        queueEdit: jest.fn(),
    } as unknown as EditQueue;
}

function makeMockWorkspace(requester: Requester, edit_queue: EditQueue): WorkspaceContext {
    return {
        requester,
        edit_queue,
    } as unknown as WorkspaceContext;
}

describe('ConnectionEventHandler', () => {
    let connection: Connection;
    let documents: TextDocuments<TextDocument>;
    let extensionState: ExtensionState;
    let workspace: WorkspaceContext;
    let requester: Requester;
    let editQueue: EditQueue;
    let handler: ConnectionEventHandler;

    beforeEach(() => {
        connection = makeMockConnection();
        documents = {
            get: jest.fn(),
        } as unknown as TextDocuments<TextDocument>;

        requester = makeMockRequester();
        editQueue = makeMockEditQueue();
        workspace = makeMockWorkspace(requester, editQueue);

        // The handler reaches into ExtensionState for routing. Stub only the
        // methods it actually calls so each test can decide whether a
        // workspace owns the URI.
        extensionState = {
            getWorkspaceForUri: jest.fn().mockReturnValue(workspace),
            defaultWorkspace: jest.fn().mockReturnValue(workspace),
            registerWorkspace: jest.fn().mockReturnValue({
                initialize: jest.fn(),
            }),
            allWorkspaces: jest.fn().mockReturnValue([]),
            onDidChangeWatchedFiles: jest.fn(),
        } as unknown as ExtensionState;

        handler = new ConnectionEventHandler(extensionState, connection, documents);
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    describe('constructor', () => {
        it.each(hooks)('registers a handler for connection.%s', hook => {
            expect((connection as any)[hook]).toHaveBeenCalled();
        });

        it('registers a semantic tokens handler', () => {
            expect((connection as any).languages.semanticTokens.on).toHaveBeenCalled();
        });
    });

    describe('onInitialize', () => {
        it('registers the workspace from params.rootPath and runs its initialise', () => {
            const initialize = jest.fn();
            (extensionState.registerWorkspace as jest.Mock).mockReturnValue({ initialize });

            const result = handler.onInitialize({ rootPath: '/path/to/workspace' } as any);

            expect(extensionState.registerWorkspace).toHaveBeenCalledWith('/path/to/workspace');
            expect(initialize).toHaveBeenCalled();
            expect(result.capabilities).toEqual(expect.objectContaining({
                completionProvider: { triggerCharacters: ['.', ':'], resolveProvider: false },
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                hoverProvider: true,
                definitionProvider: true,
                declarationProvider: true,
                referencesProvider: true,
                signatureHelpProvider: { triggerCharacters: ['(', '['] },
                implementationProvider: true,
                typeDefinitionProvider: true,
                renameProvider: true,
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                semanticTokensProvider: expect.objectContaining({
                    legend: SEMANTIC_TOKENS_LEGEND,
                    full: true,
                    range: false,
                }),
            }));
        });
    });

    describe('onShutdown', () => {
        it('kills the server manager of every registered workspace', () => {
            const killA = jest.fn();
            const killB = jest.fn();
            (extensionState.allWorkspaces as jest.Mock).mockReturnValue([
                { server_manager: { kill: killA } },
                { server_manager: { kill: killB } },
            ]);

            handler.onShutdown();

            expect(killA).toHaveBeenCalled();
            expect(killB).toHaveBeenCalled();
        });
    });

    describe('per-URI request routing', () => {
        const URI = 'file:///workspace/file.ghul';

        it('onCompletion with `.` trigger flushes the queue and routes via the URI', async () => {
            const params: CompletionParams = {
                textDocument: { uri: URI },
                position: { line: 1, character: 2 },
                context: { triggerCharacter: '.', triggerKind: 1 },
            };

            await handler.onCompletion(params);

            expect(extensionState.getWorkspaceForUri).toHaveBeenCalledWith(URI);
            expect(editQueue.sendQueued).toHaveBeenCalled();
            expect(requester.sendCompletion).toHaveBeenCalledWith(URI, 1, 2);
        });

        it('onCompletion without `.` trigger does not flush the queue', async () => {
            const params: CompletionParams = {
                textDocument: { uri: URI },
                position: { line: 1, character: 2 },
                context: { triggerCharacter: '@', triggerKind: 1 },
            };

            await handler.onCompletion(params);

            expect(editQueue.sendQueued).not.toHaveBeenCalled();
            expect(requester.sendCompletion).toHaveBeenCalledWith(URI, 1, 2);
        });

        it('onHover routes via the URI', async () => {
            const params: TextDocumentPositionParams = {
                textDocument: { uri: URI },
                position: { line: 3, character: 4 },
            };

            await handler.onHover(params);

            expect(requester.sendHover).toHaveBeenCalledWith(URI, 3, 4);
        });

        it('onDefinition routes via the URI', async () => {
            const params: TextDocumentPositionParams = {
                textDocument: { uri: URI },
                position: { line: 0, character: 0 },
            };

            await handler.onDefinition(params);

            expect(requester.sendDefinition).toHaveBeenCalledWith(URI, 0, 0);
        });

        it('onDeclaration routes via the URI', async () => {
            const params: TextDocumentPositionParams = {
                textDocument: { uri: URI },
                position: { line: 0, character: 0 },
            };

            await handler.onDeclaration(params);

            expect(requester.sendDeclaration).toHaveBeenCalledWith(URI, 0, 0);
        });

        it('onSignatureHelp flushes the queue and routes via the URI', async () => {
            const params: TextDocumentPositionParams = {
                textDocument: { uri: URI },
                position: { line: 1, character: 2 },
            };

            await handler.onSignatureHelp(params);

            expect(editQueue.sendQueued).toHaveBeenCalled();
            expect(requester.sendSignature).toHaveBeenCalledWith(URI, 1, 2);
        });

        it('onDocumentSymbol routes via the URI', async () => {
            const params: DocumentSymbolParams = { textDocument: { uri: URI } };

            await handler.onDocumentSymbol(params);

            expect(requester.sendDocumentSymbol).toHaveBeenCalledWith(URI);
        });

        it('onReferences routes via the URI', async () => {
            const params: ReferenceParams = {
                textDocument: { uri: URI },
                position: { line: 5, character: 6 },
                context: { includeDeclaration: true },
            };

            await handler.onReferences(params);

            expect(requester.sendReferences).toHaveBeenCalledWith(URI, 5, 6);
        });

        it('onImplementation routes via the URI', async () => {
            const params: TextDocumentPositionParams = {
                textDocument: { uri: URI },
                position: { line: 0, character: 0 },
            };

            await handler.onImplementation(params);

            expect(requester.sendImplementation).toHaveBeenCalledWith(URI, 0, 0);
        });

        it('onTypeDefinition routes via the URI', async () => {
            const params: TextDocumentPositionParams = {
                textDocument: { uri: URI },
                position: { line: 0, character: 0 },
            };

            await handler.onTypeDefinition(params);

            expect(requester.sendTypeDefinition).toHaveBeenCalledWith(URI, 0, 0);
        });

        it('onRenameRequest routes via the URI and passes the new name', async () => {
            await handler.onRenameRequest({
                textDocument: { uri: URI },
                position: { line: 1, character: 2 },
                newName: 'NewName',
            } as any);

            expect(requester.sendRenameRequest).toHaveBeenCalledWith(URI, 1, 2, 'NewName');
        });

        it('onSemanticTokens flushes the queue and routes via the URI', async () => {
            await handler.onSemanticTokens({
                textDocument: { uri: URI },
            } as any);

            expect(editQueue.sendQueued).toHaveBeenCalled();
            expect(requester.sendSemanticTokens).toHaveBeenCalledWith(URI);
        });

        it('onDocumentFormatting routes via the URI when the buffer is known', async () => {
            (documents.get as jest.Mock).mockReturnValue({
                getText: () => 'source',
                lineCount: 3,
            });

            await handler.onDocumentFormatting({ textDocument: { uri: URI } } as any);

            expect(requester.sendDocumentFormatting).toHaveBeenCalledWith(
                URI,
                'source',
                expect.objectContaining({ start: { line: 0, character: 0 } })
            );
        });

        it('onDocumentRangeFormatting routes via the URI when the buffer is known', async () => {
            (documents.get as jest.Mock).mockReturnValue({
                getText: () => 'source',
                lineCount: 9,
            });
            const range = { start: { line: 3, character: 4 }, end: { line: 5, character: 0 } };

            await handler.onDocumentRangeFormatting({
                textDocument: { uri: URI },
                range,
            } as any);

            expect(requester.sendDocumentRangeFormatting).toHaveBeenCalledWith(URI, 'source', range);
        });
    });

    describe('untracked URIs short-circuit', () => {
        beforeEach(() => {
            (extensionState.getWorkspaceForUri as jest.Mock).mockReturnValue(null);
        });

        it('onCompletion returns an empty list when no workspace owns the URI', async () => {
            const result = await handler.onCompletion({
                textDocument: { uri: 'file:///outside.ghul' },
                position: { line: 0, character: 0 },
                context: { triggerCharacter: '.', triggerKind: 1 },
            });

            expect(result).toEqual([]);
            expect(requester.sendCompletion).not.toHaveBeenCalled();
        });

        it('onHover returns null when no workspace owns the URI', async () => {
            const result = await handler.onHover({
                textDocument: { uri: 'file:///outside.ghul' },
                position: { line: 0, character: 0 },
            });

            expect(result).toBeNull();
            expect(requester.sendHover).not.toHaveBeenCalled();
        });

        it('onDocumentFormatting returns an empty list when no workspace owns the URI', async () => {
            const result = await handler.onDocumentFormatting({
                textDocument: { uri: 'file:///outside.ghul' },
            } as any);

            expect(result).toEqual([]);
            expect(requester.sendDocumentFormatting).not.toHaveBeenCalled();
        });
    });

    describe('workspace-wide requests', () => {
        it('onWorkspaceSymbol routes to the default workspace', async () => {
            await handler.onWorkspaceSymbol();

            expect(extensionState.defaultWorkspace).toHaveBeenCalled();
            expect(requester.sendWorkspaceSymbol).toHaveBeenCalled();
        });

        it('onWorkspaceSymbol returns an empty list when no workspace is registered', async () => {
            (extensionState.defaultWorkspace as jest.Mock).mockReturnValue(null);

            const result = await handler.onWorkspaceSymbol();

            expect(result).toEqual([]);
            expect(requester.sendWorkspaceSymbol).not.toHaveBeenCalled();
        });
    });
});
