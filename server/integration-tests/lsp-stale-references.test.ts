import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { LspClient } from './lsp-client';

// A referenced project that has been built, and has been edited since. Its
// output assembly is present, so nothing that only asks whether it exists can
// tell there is a problem — but the analyser can only see a reference as
// metadata it reflects over, so it answers from the last build and reports
// everything added since as not found. Diagnostics that name real symbols as
// missing, on a project that compiles.
//
// The scenario is ordinary: edit a referenced project, restart the editor.
// It reproduces only against a real build and a real analyser, because both
// halves of the failure — an assembly that satisfies a presence check, and a
// symbol table built by reflecting over it — are outside the server.
//
// Same requirements as the other tests in this tier: `dotnet` on PATH,
// network access for the tool restore, and the server built first.

const SERVER_PATH = join(__dirname, '..', 'out', 'server.js');
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'referenced-project');
const LIBRARY_PATH = join(FIXTURE_ROOT, 'lib', 'bin', 'Debug', 'net10.0', 'lib.dll');

// Written by the test rather than committed: the fixture has to be buildable
// without them, because the first run below is what puts the library on disk
// in the state the second run finds out of date.
const ADDED_LIBRARY_SOURCE = join(FIXTURE_ROOT, 'lib', 'src', 'extra.ghul');
const ADDED_SOURCE = join(FIXTURE_ROOT, 'src', 'uses-extra.ghul');

const ADDED_LIBRARY_TEXT = `namespace Lib is
    class EXTRA is
        init() is si

        farewell() -> string => "goodbye from the library";
    si
si
`;

const ADDED_TEXT = `namespace App is
    class USES_EXTRA is
        init() is si

        run() -> string => Lib.EXTRA().farewell();
    si
si
`;

function cleanGeneratedArtifacts() {
    for (const relative of [
        'bin', 'obj', '.assemblies.json', '.analysis.rsp', '.build.rsp',
        'lib/bin', 'lib/obj', 'lib/.build.rsp',
    ]) {
        rmSync(join(FIXTURE_ROOT, relative), { recursive: true, force: true });
    }

    rmSync(ADDED_LIBRARY_SOURCE, { force: true });
    rmSync(ADDED_SOURCE, { force: true });
}

// Waits on the file rather than on anything the server says about it, so the
// test states what has to be true and not how this version of the server goes
// about it.
async function waitForLibrary(timeout_ms: number): Promise<void> {
    const deadline = Date.now() + timeout_ms;

    while (!existsSync(LIBRARY_PATH)) {
        if (Date.now() > deadline) {
            throw new Error(`${LIBRARY_PATH} was not built within ${timeout_ms}ms`);
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

function initializeParams() {
    return {
        processId: process.pid,
        rootUri: 'file://' + FIXTURE_ROOT,
        workspaceFolders: [{ uri: 'file://' + FIXTURE_ROOT, name: 'fixture' }],
        capabilities: {
            window: { workDoneProgress: true },
            workspace: {
                didChangeWatchedFiles: { dynamicRegistration: true },
                workspaceFolders: true,
            },
        },
    };
}

describe('start-up on a tree whose referenced project has been built and then edited', () => {
    let client: LspClient;

    beforeAll(() => {
        if (!existsSync(SERVER_PATH)) {
            throw new Error(
                `${SERVER_PATH} does not exist — build it first: ` +
                `npm run genversion && webpack --mode production --config ./server/webpack.config.js`
            );
        }
    });

    beforeEach(() => cleanGeneratedArtifacts());

    afterEach(async () => {
        await client?.dispose();
        cleanGeneratedArtifacts();
    });

    it('rebuilds the reference so the analyser sees what was added to it', async () => {
        // First session: build the library as it stands. Its assembly is now
        // present and correct, which is the state the second session starts
        // from and the reason the staleness is invisible to a presence check.
        const first = new LspClient(SERVER_PATH, FIXTURE_ROOT);

        try {
            await first.request('initialize', initializeParams());
            first.notify('initialized', {});

            await waitForLibrary(180000);
        } finally {
            await first.dispose();
        }

        const built_at = statSync(LIBRARY_PATH).mtimeMs;

        // The edit: a type the built assembly knows nothing about, and a use
        // of it in the project being analysed.
        writeFileSync(ADDED_LIBRARY_SOURCE, ADDED_LIBRARY_TEXT);
        writeFileSync(ADDED_SOURCE, ADDED_TEXT);

        // Second session: the editor reopened on the edited tree.
        client = new LspClient(SERVER_PATH, FIXTURE_ROOT);

        const uri = 'file://' + ADDED_SOURCE;

        await client.request('initialize', initializeParams());
        client.notify('initialized', {});

        client.notify('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: 'ghul',
                version: 1,
                text: readFileSync(ADDED_SOURCE, 'utf8'),
            },
        });

        // Hovering the use of the added type. The request is held until the
        // analyser has compiled the project, so an answer naming the type
        // means the assembly it reflected over was rebuilt first. Against the
        // one the first session left behind, the type does not exist and the
        // file carries a symbol-not-found error instead.
        const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position: { line: 4, character: 32 },
        });

        expect(JSON.stringify(hover)).toContain('EXTRA');

        expect(statSync(LIBRARY_PATH).mtimeMs).toBeGreaterThan(built_at);
    });
});
