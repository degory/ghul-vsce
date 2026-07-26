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
    // Required inside the factory rather than taken from the import above:
    // jest.mock is hoisted above the imports, so the import is not yet
    // initialised when this runs.
    const { EventEmitter: MockEventEmitter } = require('events');

    const fakeChild: any = new MockEventEmitter();
    fakeChild.pid = 1234;
    fakeChild.stdout = new MockEventEmitter();
    fakeChild.stderr = new MockEventEmitter();
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

const progressReporter = {
    begin: jest.fn(),
    report: jest.fn(),
    done: jest.fn(),
};

function makeMockConnection(): Connection {
    return {
        window: {
            showErrorMessage: jest.fn(),
            showWarningMessage: jest.fn(),
            createWorkDoneProgress: jest.fn(() => Promise.resolve(progressReporter)),
        },
        // ResponseHandler's constructor subscribes to the config-event emitter
        // and otherwise uses Connection only for sendDiagnostics; the tests
        // here don't exercise that path, so an empty stub is enough.
        sendDiagnostics: jest.fn(),
    } as unknown as Connection;
}

function makeMockDocuments(): TextDocuments<TextDocument> {
    return {
        all: (): TextDocument[] => [],
    } as unknown as TextDocuments<TextDocument>;
}

describe('WorkspaceContext.initialize', () => {
    const WORKSPACE_ROOT = '/path/to/workspace';

    let connection: Connection;
    let documents: TextDocuments<TextDocument>;
    let context: WorkspaceContext;

    beforeEach(() => {
        progressReporter.begin.mockClear();
        progressReporter.report.mockClear();
        progressReporter.done.mockClear();

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

    it('generates .assemblies.json before reading it via getGhulConfig', async () => {
        // getGhulConfig builds the -a argument list from .assemblies.json,
        // which is written by generateAssembliesJson. If the read runs first
        // on a fresh checkout where the file does not yet exist, .analysis.rsp
        // ends up empty and the analyser falls back to a tiny default
        // assembly list — producing spurious "not defined" / "not found"
        // diagnostics for any reference outside that list.
        const restoreDotNetToolsSpy = jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockResolvedValue(null);
        const generateAssembliesJsonSpy = jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockResolvedValue(null);
        const getGhulConfigSpy = jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            missing_assemblies: [],
            problems: [],
        } as GhulConfig);

        await context.initialize();

        const restoreOrder = restoreDotNetToolsSpy.mock.invocationCallOrder[0];
        const generateOrder = generateAssembliesJsonSpy.mock.invocationCallOrder[0];
        const configOrder = getGhulConfigSpy.mock.invocationCallOrder[0];

        expect(restoreOrder).toBeLessThan(generateOrder);
        expect(generateOrder).toBeLessThan(configOrder);
        expect(restoreDotNetToolsSpy).toHaveBeenCalledWith(WORKSPACE_ROOT);
        expect(generateAssembliesJsonSpy).toHaveBeenCalledWith(WORKSPACE_ROOT);
        expect(getGhulConfigSpy).toHaveBeenCalledWith(WORKSPACE_ROOT);
    });

    it('surfaces a warning when the config loaded with problems but is still runnable', async () => {
        // A degraded load — e.g. a malformed .assemblies.json — still has a
        // usable compiler, so analysis proceeds but the user is told why it
        // may be incomplete.
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockResolvedValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockResolvedValue(null);
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            missing_assemblies: [],
            problems: ['could not load .assemblies.json: unexpected token'],
        } as GhulConfig);

        await context.initialize();

        expect(connection.window.showWarningMessage).toHaveBeenCalledTimes(1);
        const [message] = (connection.window.showWarningMessage as jest.Mock).mock.calls[0];
        expect(message).toContain('.assemblies.json');
    });

    it('does not warn when the config loaded cleanly', async () => {
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockResolvedValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockResolvedValue(null);
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            missing_assemblies: [],
            problems: [],
        } as GhulConfig);

        await context.initialize();

        expect(connection.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('creates a DocumentChangeTracker whose globs are anchored under the workspace root', async () => {
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockResolvedValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockResolvedValue(null);
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue({
            compiler: ['ghul'],
            source: ['./src/**/*.ghul', './lib/**/*.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            missing_assemblies: [],
            problems: [],
        } as GhulConfig);

        await context.initialize();

        expect(context.document_change_tracker.globs).toEqual([
            `${WORKSPACE_ROOT}/./src/**/*.ghul`,
            `${WORKSPACE_ROOT}/./lib/**/*.ghul`,
        ]);
    });

    it('fires configAvailable with the workspace root and loaded config', async () => {
        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockResolvedValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockResolvedValue(null);
        const config = {
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            missing_assemblies: [],
            problems: [],
        } as GhulConfig;
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue(config);

        const configAvailableSpy = jest.spyOn(context.config_event_emitter, 'configAvailable');

        await context.initialize();

        expect(configAvailableSpy).toHaveBeenCalledWith(WORKSPACE_ROOT, config);
    });

    function stubConfig(missing_assemblies: string[]): GhulConfig {
        const config = {
            compiler: ['ghul'],
            source: ['test.ghul'],
            arguments: [],
            want_plaintext_hover: false,
            missing_assemblies,
            problems: [],
        } as GhulConfig;

        jest.spyOn(restoreDotNetTools, 'restoreDotNetTools').mockResolvedValue(null);
        jest.spyOn(generateAssembliesJson, 'generateAssembliesJson').mockResolvedValue(null);
        jest.spyOn(GetGhulConfig, 'getGhulConfig').mockReturnValue(config);

        return config;
    }

    it('withholds diagnostics while a referenced assembly is yet to be built', async () => {
        stubConfig(['/path/to/workspace/lib/bin/Debug/net10.0/lib.dll']);

        jest.spyOn(generateAssembliesJson, 'buildReferencedAssemblies')
            .mockReturnValue(new Promise(() => { /* never settles */ }));

        await context.initialize();

        expect(context.response_handler.suppress_diagnostics).toBe(true);
        expect(connection.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('releases diagnostics and warns when a referenced assembly is still absent after the build', async () => {
        stubConfig(['/path/to/workspace/lib/bin/Debug/net10.0/lib.dll']);

        // Resolving without the assembly appearing is the build-failed case:
        // the user now has to act, so the incomplete diagnostics are better
        // than none and the warning explains them.
        jest.spyOn(generateAssembliesJson, 'buildReferencedAssemblies')
            .mockResolvedValue(null);

        await context.initialize();

        await new Promise(resolve => setImmediate(resolve));

        expect(context.response_handler.suppress_diagnostics).toBe(false);
        expect(connection.window.showWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining('analysis will be incomplete')
        );
    });

    it('reports progress through the setup the user would otherwise wait blind through', async () => {
        stubConfig([]);

        await context.initialize();

        expect(connection.window.createWorkDoneProgress).toHaveBeenCalled();
        expect(progressReporter.begin).toHaveBeenCalled();
        expect(progressReporter.report.mock.calls.map(([message]) => message)).toEqual([
            'restoring .NET tools',
            'resolving project references',
        ]);
        expect(progressReporter.done).toHaveBeenCalled();
    });

    it('sets up without progress on a client that cannot report it', async () => {
        stubConfig([]);

        (connection.window as any).createWorkDoneProgress = undefined;

        await context.initialize();

        expect(context.config).toBeDefined();
    });

    it('does not withhold diagnostics when every referenced assembly is present', async () => {
        stubConfig([]);

        const buildSpy = jest.spyOn(generateAssembliesJson, 'buildReferencedAssemblies');

        await context.initialize();

        expect(context.response_handler.suppress_diagnostics).toBe(false);
        expect(buildSpy).not.toHaveBeenCalled();
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

    it('returns false for an empty folder', async () => {
        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(false);
    });

    it('returns false for null or empty workspace root', async () => {
        expect(WorkspaceContext.looksLikeGhulWorkspace(null as any)).toBe(false);
        expect(WorkspaceContext.looksLikeGhulWorkspace('')).toBe(false);
    });

    it('returns true when the folder contains a .ghulproj', async () => {
        const { writeFileSync } = jest.requireActual('fs');
        const path = jest.requireActual('path');
        writeFileSync(path.join(tmpDir, 'thing.ghulproj'), '<Project />');

        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(true);
    });

    it('returns true when the folder contains a ghul.json', async () => {
        const { writeFileSync } = jest.requireActual('fs');
        const path = jest.requireActual('path');
        writeFileSync(path.join(tmpDir, 'ghul.json'), '{}');

        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(true);
    });

    it('returns false when the only .ghul files are sources (no project file)', async () => {
        // A folder of loose .ghul scripts isn't a project we can analyse;
        // without a .ghulproj or ghul.json there's no compiler config to load.
        const { writeFileSync } = jest.requireActual('fs');
        const path = jest.requireActual('path');
        writeFileSync(path.join(tmpDir, 'main.ghul'), 'class X is si X() is end end');

        expect(WorkspaceContext.looksLikeGhulWorkspace(tmpDir)).toBe(false);
    });

    it('returns true for paths containing glob metacharacters', async () => {
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

    it('returns false for a non-existent folder', async () => {
        expect(WorkspaceContext.looksLikeGhulWorkspace('/no/such/folder/anywhere'))
            .toBe(false);
    });
});
