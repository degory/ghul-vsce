import { EventEmitter } from 'events';

import { Connection, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { WorkspaceContext } from '../src/workspace-context';
import { GhulConfig } from '../src/ghul-config';

import * as GetGhulConfig from '../src/ghul-config';
import * as restoreDotNetTools from '../src/restore-dotnet-tools';
import * as generateAssembliesJson from '../src/generate-assemblies-json';

// initialize() fires configAvailable, which wakes the ServerManager and makes
// it write .analysis.rsp and spawn the compiler. We're not exercising that
// path here, so stub it out at the module boundary.
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    writeFileSync: jest.fn(),
}));

jest.mock('child_process', () => {
    const fakeChild: any = new EventEmitter();
    fakeChild.pid = 1234;
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill = jest.fn();
    return {
        ...jest.requireActual('child_process'),
        spawn: jest.fn(() => fakeChild),
    };
});

// WorkspaceContext is where per-workspace setup lives — the work that used to
// happen in ConnectionEventHandler.initialize(). These tests pin the ordering
// of the on-disk setup (so a fresh checkout doesn't fall back to a tiny
// default assembly list) and the surfacing of degraded-load warnings.

function makeMockConnection(): Connection {
    return {
        window: {
            showErrorMessage: jest.fn(),
            showWarningMessage: jest.fn(),
        },
        // ResponseHandler's constructor subscribes to the config-event emitter
        // and otherwise uses Connection only for sendDiagnostics; the tests
        // here don't exercise that path, so an empty stub is enough.
        sendDiagnostics: jest.fn(),
    } as unknown as Connection;
}

function makeMockDocuments(): TextDocuments<TextDocument> {
    return {
        all: () => [],
    } as unknown as TextDocuments<TextDocument>;
}

describe('WorkspaceContext.initialize', () => {
    const WORKSPACE_ROOT = '/path/to/workspace';

    let connection: Connection;
    let documents: TextDocuments<TextDocument>;
    let context: WorkspaceContext;

    beforeEach(() => {
        connection = makeMockConnection();
        documents = makeMockDocuments();
        context = new WorkspaceContext(WORKSPACE_ROOT, connection, documents);
    });

    afterEach(() => {
        // The constructor created a Watchdog. If a test armed it, clear it so
        // the timer can't fire into a torn-down test and crash the worker.
        context.watchdog.clearWatchdog();
        jest.restoreAllMocks();
    });

    it('generates .assemblies.json before reading it via getGhulConfig', () => {
        // getGhulConfig builds the -a argument list from .assemblies.json,
        // which is written by generateAssembliesJson. If the read runs first
        // on a fresh checkout where the file does not yet exist, .analysis.rsp
        // ends up empty and the analyser falls back to a tiny default
        // assembly list — producing spurious "not defined" / "not found"
        // diagnostics for any reference outside that list.
        const restoreDotNetToolsSpy = jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockReturnValue(null);
        const generateAssembliesJsonSpy = jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockReturnValue(null);
        const getGhulConfigSpy = jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            problems: [],
        } as GhulConfig);

        context.initialize();

        const restoreOrder = restoreDotNetToolsSpy.mock.invocationCallOrder[0];
        const generateOrder = generateAssembliesJsonSpy.mock.invocationCallOrder[0];
        const configOrder = getGhulConfigSpy.mock.invocationCallOrder[0];

        expect(restoreOrder).toBeLessThan(generateOrder);
        expect(generateOrder).toBeLessThan(configOrder);
        expect(restoreDotNetToolsSpy).toHaveBeenCalledWith(WORKSPACE_ROOT);
        expect(generateAssembliesJsonSpy).toHaveBeenCalledWith(WORKSPACE_ROOT);
        expect(getGhulConfigSpy).toHaveBeenCalledWith(WORKSPACE_ROOT);
    });

    it('surfaces a warning when the config loaded with problems but is still runnable', () => {
        // A degraded load — e.g. a malformed .assemblies.json — still has a
        // usable compiler, so analysis proceeds but the user is told why it
        // may be incomplete.
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockReturnValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockReturnValue(null);
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            problems: ['could not load .assemblies.json: unexpected token'],
        } as GhulConfig);

        context.initialize();

        expect(connection.window.showWarningMessage).toHaveBeenCalledTimes(1);
        const [message] = (connection.window.showWarningMessage as jest.Mock).mock.calls[0];
        expect(message).toContain('.assemblies.json');
    });

    it('does not warn when the config loaded cleanly', () => {
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockReturnValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockReturnValue(null);
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            problems: [],
        } as GhulConfig);

        context.initialize();

        expect(connection.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('creates a DocumentChangeTracker whose globs are anchored under the workspace root', () => {
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockReturnValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockReturnValue(null);
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['./src/**/*.ghul', './lib/**/*.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            problems: [],
        } as GhulConfig);

        context.initialize();

        expect(context.document_change_tracker.globs).toEqual([
            `${WORKSPACE_ROOT}/./src/**/*.ghul`,
            `${WORKSPACE_ROOT}/./lib/**/*.ghul`,
        ]);
    });

    it('fires configAvailable with the workspace root and loaded config', () => {
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockReturnValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockReturnValue(null);
        const config = {
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            problems: [],
        } as GhulConfig;
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue(config);

        const configAvailableSpy = jest.spyOn(context.config_event_emitter, 'configAvailable');

        context.initialize();

        expect(configAvailableSpy).toHaveBeenCalledWith(WORKSPACE_ROOT, config);
    });
});

describe('WorkspaceContext.looksLikeGhulWorkspace', () => {
    let tmpDir: string;

    beforeEach(() => {
        const { mkdtempSync } = jest.requireActual('fs');
        const { tmpdir } = jest.requireActual('os');
        const path = jest.requireActual('path');
        tmpDir = mkdtempSync(path.join(tmpdir(), 'ghul-vsce-looks-like-'));
    });

    afterEach(() => {
        const { rmSync } = jest.requireActual('fs');
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns false for an empty folder', () => {
        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(false);
    });

    it('returns false for null or empty workspace root', () => {
        expect(WorkspaceContext.looksLikeGhulWorkspace(null as any)).toBe(false);
        expect(WorkspaceContext.looksLikeGhulWorkspace('')).toBe(false);
    });

    it('returns true when the folder contains a .ghulproj', () => {
        const { writeFileSync } = jest.requireActual('fs');
        const path = jest.requireActual('path');
        writeFileSync(path.join(tmpDir, 'thing.ghulproj'), '<Project />');

        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(true);
    });

    it('returns true when the folder contains a ghul.json', () => {
        const { writeFileSync } = jest.requireActual('fs');
        const path = jest.requireActual('path');
        writeFileSync(path.join(tmpDir, 'ghul.json'), '{}');

        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(true);
    });

    it('returns false when the only .ghul files are sources (no project file)', () => {
        // A folder of loose .ghul scripts isn't a project we can analyse;
        // without a .ghulproj or ghul.json there's no compiler config to load.
        const { writeFileSync } = jest.requireActual('fs');
        const path = jest.requireActual('path');
        writeFileSync(path.join(tmpDir, 'main.ghul'), 'class X is si X() is end end');

        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(false);
    });

    it('returns true for paths containing glob metacharacters', () => {
        // globSync silently mis-parses paths containing metacharacters
        // (`[`, `]`, `{`, `}`, `?`), returning no matches and leaving the
        // analyser unstarted; readdirSync avoids this entirely.
        const { writeFileSync, mkdtempSync } = jest.requireActual('fs');
        const { tmpdir } = jest.requireActual('os');
        const path = jest.requireActual('path');

        const trickyDir = mkdtempSync(path.join(tmpdir(), 'ghul-vsce-tricky-[v2]-'));
        try {
            writeFileSync(path.join(trickyDir, 'thing.ghulproj'), '<Project />');
            expect(WorkspaceContext.looksLikeGhulWorkspace(trickyDir)).toBe(true);
        } finally {
            const { rmSync } = jest.requireActual('fs');
            rmSync(trickyDir, { recursive: true, force: true });
        }
    });

    it('returns false for a non-existent folder', () => {
        expect(WorkspaceContext.looksLikeGhulWorkspace('/no/such/folder/anywhere'))
            .toBe(false);
    });
});
