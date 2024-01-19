import { ConnectionEventHandler } from '../src/connection-event-handler';
import { CompletionParams, Connection, DocumentSymbolParams, InitializeResult, InitializedParams, ReferenceParams, TextDocumentPositionParams, TextDocuments } from 'vscode-languageserver';
import {
    TextDocument
} from 'vscode-languageserver-textdocument';


import { ServerManager } from '../src/server-manager';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { Requester } from '../src/requester';
import { EditQueue } from '../src/edit-queue';
import { GhulConfig } from '../src/ghul-config';

import * as GetGhulConfig from '../src/ghul-config';

import * as restoreDotNetTools from '../src/restore-dotnet-tools';
import * as generateAssembliesJson from '../src/generate-assemblies-json';
import { DocumentChangeTracker } from '../src/document-change-tracker';

import * as DocumentChangeTrackerModule from '../src/document-change-tracker';

jest.mock('../src/server-manager');
jest.mock('../src/config-event-emitter');
jest.mock('../src/requester');
jest.mock('../src/edit-queue');
jest.mock('../src/document-change-tracker');

describe('ConnectionEventHandler', () => {
    let connection: Connection;
    let serverManager: ServerManager;
    let documents: TextDocuments<TextDocument>;
    let configEventEmitter: ConfigEventEmitter;
    let requester: Requester;
    let editQueue: EditQueue;
    let connectionEventHandler: ConnectionEventHandler;

    beforeEach(() => {
        connection = {
            onInitialize: (_params: InitializedParams): InitializeResult => {
                return {
                    capabilities: {
                        textDocumentSync: {
                            openClose: true,
                            change: 1
                        },
                        completionProvider: {
                            triggerCharacters: ['.'],
                            resolveProvider: false
                        },
                        documentSymbolProvider: true,
                        workspaceSymbolProvider: true,
                        hoverProvider: true,
                        definitionProvider: true,
                        declarationProvider: true,
                        referencesProvider: true,
                        signatureHelpProvider: {
                            triggerCharacters: ['(', '[']
                        },
                        implementationProvider: true,
                        renameProvider: true
                    }
                };
            },
            onShutdown: jest.fn(),
            onExit: jest.fn(),
            onDidChangeConfiguration: jest.fn(),
            onDidOpenTextDocument: jest.fn(),
            onDidOpen: jest.fn(),
            onDidCloseTextDocument: jest.fn(),
            onDidClose: jest.fn(),
            onDidChangeWatchedFiles: jest.fn(),
            onCompletion: jest.fn(),
            onHover: jest.fn(),
            onDefinition: jest.fn(),
            onDeclaration: jest.fn(),
            onSignatureHelp: jest.fn(),
            onDocumentSymbol: jest.fn(),
            onWorkspaceSymbol: jest.fn(),
            onReferences: jest.fn(),
            onImplementation: jest.fn(),
            onRenameRequest: jest.fn(),
        } as any as Connection;

        serverManager = {
            kill: jest.fn(),
        } as any as ServerManager;

        documents = {
            onDidOpen: jest.fn(),
            onDidClose: jest.fn(),
            onDidChangeContent: jest.fn(),
        } as any as TextDocuments<TextDocument>;

        configEventEmitter = {
            onConfigAvailable: jest.fn(),
            configAvailable: jest.fn(),
        } as any as ConfigEventEmitter;

        requester = {
            sendCompletion: jest.fn(),
            sendHover: jest.fn(),
            sendDefinition: jest.fn(),
            sendDeclaration: jest.fn(),
            sendSignature: jest.fn(),
            sendDocumentSymbol: jest.fn(),
            sendWorkspaceSymbol: jest.fn(),
            sendReferences: jest.fn(),
            sendImplementation: jest.fn(),
        } as any as Requester;

        editQueue = {
            sendQueued: jest.fn(),
        } as any as EditQueue;

        connectionEventHandler = new ConnectionEventHandler(connection, serverManager, documents, configEventEmitter, requester, editQueue);
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    it('should initialize correctly', () => {
        // Arrange

        const restoreDotNetToolsSpy = jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockImplementation();
        const generateAssembliesJsonSpy = jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockImplementation();
        const getGhulConfigSpy = jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: 'ghul',
            source: ["test.ghul"],
            arguments: [],
            want_plaintext_hover: false,
        } as GhulConfig);

        const documentChangeTracker = {
            onDidOpenTextDocument: jest.fn(),
            onDidOpen: jest.fn(),
            onDidCloseTextDocument: jest.fn(),
            onDidClose: jest.fn(),
            onDidChangeWatchedFiles: jest.fn(),
        } as any as DocumentChangeTracker;

        jest.spyOn(DocumentChangeTrackerModule, 'DocumentChangeTracker').mockImplementation(() => {
            return documentChangeTracker;
        });

        const configAvailableSpy = jest.spyOn(configEventEmitter, 'configAvailable').mockImplementation();

        connectionEventHandler.workspace_root = '/path/to/workspace';

        // Act
        connectionEventHandler.initialize();

        // Assert
        expect(restoreDotNetToolsSpy).toHaveBeenCalledWith(connectionEventHandler.workspace_root);
        expect(generateAssembliesJsonSpy).toHaveBeenCalledWith(connectionEventHandler.workspace_root);
        expect(getGhulConfigSpy).toHaveBeenCalledWith(connectionEventHandler.workspace_root);
        expect(connectionEventHandler.document_change_tracker).toBe(documentChangeTracker);
        expect(configAvailableSpy).toHaveBeenCalledWith(connectionEventHandler.workspace_root, {
            compiler: 'ghul',
            source: ["test.ghul"],
            arguments: [],
            want_plaintext_hover: false,
        } as GhulConfig);
    });

    it('should handle onInitialize event', () => {
        // Arrange
        const initializeSpy = jest.spyOn(connectionEventHandler, 'initialize').mockImplementation();
        const onInitializeParams = { rootPath: '/path/to/workspace' };

        // Act
        const result = connectionEventHandler.onInitialize(onInitializeParams);

        // Assert
        expect(initializeSpy).toHaveBeenCalled();
        expect(result).toEqual({
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                    change: 1
                },
                completionProvider: {
                    triggerCharacters: ['.'],
                    resolveProvider: false
                },
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                hoverProvider: true,
                definitionProvider: true,
                declarationProvider: true,
                referencesProvider: true,
                signatureHelpProvider: {
                    triggerCharacters: ['(', '[']
                },
                implementationProvider: true,
                renameProvider: true
            }
        });
    });

    // Add more test cases for other methods in the ConnectionEventHandler class
    it('should handle onShutdown event', () => {
        // Arrange
        const killSpy = jest.spyOn(serverManager, 'kill');
        const logSpy = jest.spyOn(console, 'log');

        // Act
        connectionEventHandler.onShutdown();

        // Assert
        expect(logSpy).toHaveBeenCalledWith("ghūl language extension: shutting down...");
        expect(killSpy).toHaveBeenCalled();
    })

    it('should handle onExit event', () => {
        // Arrange
        const logSpy = jest.spyOn(console, 'log');

        // Act
        connectionEventHandler.onExit();

        // Assert
        expect(logSpy).toHaveBeenCalledWith("ghūl language extension: exit");
    })

    it('should handle onDidChangeConfiguration event', () => {
        // Arrange
        const logSpy = jest.spyOn(console, 'log');

        // Act
        connectionEventHandler.onDidChangeConfiguration({
            settings: {
                ghul: {
                    compiler: 'ghul',
                    source: ["test.ghul"],
                    arguments: [],
                    want_plaintext_hover: false,
                }
            }
        });

        // Assert

        // TODO: handle configuration change is currently a NOOP
        expect(logSpy).toHaveBeenCalledWith("ghūl language extension: configuration changed");
    })

    it('should handle onCompletion event with triggerCharacter dot', async () => {
        // Arrange
        const textDocumentPosition: CompletionParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
            context: { triggerCharacter: '.', triggerKind: 1 },
        };

        const sendQueuedSpy = jest.spyOn(editQueue, 'sendQueued');
        const sendCompletionSpy = jest.spyOn(requester, 'sendCompletion').mockResolvedValue([]);

        // Act
        const result = await connectionEventHandler.onCompletion(textDocumentPosition);

        // Assert
        expect(sendQueuedSpy).toHaveBeenCalled();
        expect(sendCompletionSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual([]);
    });

    it('should handle onCompletion event with triggerCharacter other than dot', async () => {
        // Arrange
        const textDocumentPosition: CompletionParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
            context: { triggerCharacter: '@', triggerKind: 1 },
        };

        const sendQueuedSpy = jest.spyOn(editQueue, 'sendQueued');
        const sendCompletionSpy = jest.spyOn(requester, 'sendCompletion').mockResolvedValue([]);

        // Act
        const result = await connectionEventHandler.onCompletion(textDocumentPosition);

        // Assert
        expect(sendQueuedSpy).not.toHaveBeenCalled();
        expect(sendCompletionSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual([]);
    });

    it('should handle onHover event', async () => {
        // Arrange
        const textDocumentPosition: TextDocumentPositionParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
        };

        const sendHoverSpy = jest.spyOn(requester, 'sendHover').mockResolvedValue({ contents: 'Hover content' });

        // Act
        const result = await connectionEventHandler.onHover(textDocumentPosition);

        // Assert
        expect(sendHoverSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual({ contents: 'Hover content' });
    });

    it('should handle onDefinition event', async () => {
        // Arrange
        const textDocumentPosition: TextDocumentPositionParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
        };

        const sendDefinitionSpy = jest.spyOn(requester, 'sendDefinition').mockResolvedValue({ uri: 'definition-uri', range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } } });

        // Act
        const result = await connectionEventHandler.onDefinition(textDocumentPosition);

        // Assert
        expect(sendDefinitionSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual({ uri: 'definition-uri', range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } } });
    });

    it('should handle onDeclaration event', async () => {
        // Arrange
        const textDocumentPosition: TextDocumentPositionParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
        };

        const sendDeclarationSpy = jest.spyOn(requester, 'sendDeclaration').mockResolvedValue({ uri: 'declaration-uri', range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } } });

        // Act
        const result = await connectionEventHandler.onDeclaration(textDocumentPosition);

        // Assert
        expect(sendDeclarationSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual({ uri: 'declaration-uri', range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } } });
    });

    it('should handle onSignatureHelp event', async () => {
        // Arrange
        const textDocumentPosition: TextDocumentPositionParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
        };

        const sendQueuedSpy = jest.spyOn(editQueue, 'sendQueued');

        let expectedSignatures = {
            signatures: [
                {
                    label: 'signature-label',
                    documentation: 'signature-documentation',
                    parameters: [
                        {
                            label: 'parameter-label',
                            documentation: 'parameter-documentation',
                        }
                    ]
                }
            ],
            activeSignature: 0,
            activeParameter: 0,
        }

        const sendSignatureSpy = jest.spyOn(requester, 'sendSignature').mockResolvedValue(expectedSignatures);

        // Act
        const result = await connectionEventHandler.onSignatureHelp(textDocumentPosition);

        // Assert
        expect(sendQueuedSpy).toHaveBeenCalled();
        expect(sendSignatureSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual(expectedSignatures);
    });

    it('should handle onDocumentSymbol event', async () => {
        // Arrange
        const documentSymbolParams: DocumentSymbolParams = {
            textDocument: { uri: 'test-uri' },
        };

        const sendDocumentSymbolSpy = jest.spyOn(requester, 'sendDocumentSymbol').mockResolvedValue([]);

        // Act
        const result = await connectionEventHandler.onDocumentSymbol(documentSymbolParams);

        // Assert
        expect(sendDocumentSymbolSpy).toHaveBeenCalledWith('test-uri');
        expect(result).toEqual([]);
    });

    it('should handle onWorkspaceSymbol event', async () => {
        // Arrange
        const sendWorkspaceSymbolSpy = jest.spyOn(requester, 'sendWorkspaceSymbol').mockResolvedValue([]);

        // Act
        const result = await connectionEventHandler.onWorkspaceSymbol();

        // Assert
        expect(sendWorkspaceSymbolSpy).toHaveBeenCalled();
        expect(result).toEqual([]);
    });

    it('should handle onReferences event', async () => {
        // Arrange
        const referenceParams: ReferenceParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
            context: { includeDeclaration: true },
        };

        const sendReferencesSpy = jest.spyOn(requester, 'sendReferences').mockResolvedValue([]);

        // Act
        const result = await connectionEventHandler.onReferences(referenceParams);

        // Assert
        expect(sendReferencesSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual([]);
    });

    it('should handle onImplementation event', async () => {
        // Arrange
        const textDocumentPosition: TextDocumentPositionParams = {
            textDocument: { uri: 'test-uri' },
            position: { line: 1, character: 2 },
        };

        const sendImplementationSpy = jest.spyOn(requester, 'sendImplementation').mockResolvedValue([]);

        // Act
        const result = await connectionEventHandler.onImplementation(textDocumentPosition);

        // Assert
        expect(sendImplementationSpy).toHaveBeenCalledWith('test-uri', 1, 2);
        expect(result).toEqual([]);
    });
});