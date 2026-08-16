import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

import { LspClient } from './lsp-client';

// A workspace whose referenced projects have never been built — a fresh
// clone, a new Codespace. Setup builds them before it reads what they
// resolved to, so the analyser it then starts is the only analyser this
// start-up needs: one tool restore, one reference build, one compiler.
//
// Worth pinning end to end because the alternative is not a slower start-up
// but a wrong one, and every part of that is invisible from inside the
// server. Only reproducible against a real client and a real build.
// Same requirements as the other tests in this tier: `dotnet` on PATH,
// network access for the tool restore, and the server built first.

const SERVER_PATH = join(__dirname, '..', 'out', 'server.js');
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'referenced-project');
const SOURCE_PATH = join(FIXTURE_ROOT, 'src', 'main.ghul');
const LIBRARY_PATH = join(FIXTURE_ROOT, 'lib', 'bin', 'Debug', 'net10.0', 'lib.dll');

function cleanGeneratedArtifacts() {
    for (const relative of [
        'bin', 'obj', '.assemblies.json', '.analysis.rsp', '.build.rsp',
        'lib/bin', 'lib/obj', 'lib/.build.rsp',
    ]) {
        rmSync(join(FIXTURE_ROOT, relative), { recursive: true, force: true });
    }
}

describe('start-up on a tree whose referenced projects have never been built', () => {
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

    it('builds the reference during setup and starts one analyser on it', async () => {
        client = new LspClient(SERVER_PATH, FIXTURE_ROOT);

        const uri = 'file://' + SOURCE_PATH;

        await client.request('initialize', {
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
        });

        client.notify('initialized', {});

        await client.waitForLog(
            message => message.includes('finished building project references'),
            180000,
            'the project reference build finishing'
        );

        expect(existsSync(LIBRARY_PATH)).toBe(true);

        client.notify('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: 'ghul',
                version: 1,
                text: readFileSync(SOURCE_PATH, 'utf8'),
            },
        });

        // Held until the analyser has compiled the project, so reaching an
        // answer at all means it started on a reference set that already
        // included the library.
        const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position: { line: 6, character: 32 },
        });

        expect(JSON.stringify(hover)).toContain('THING');

        // Long enough for a second setup to have started, had anything been
        // left for one to do. The change tracker debounces its re-initialize
        // by five seconds.
        await new Promise(resolve => setTimeout(resolve, 15000));

        // The reference was built before the reference set was read, so there
        // is nothing left to discover afterwards and nothing to set up for a
        // second time. Each of these repeated is tens of seconds of the
        // user's time and an analyser thrown away and restarted from cold.
        expect(client.countLogs('restoring .NET tools...')).toBe(1);
        expect(client.countLogs('building project references...')).toBe(1);
        expect(client.countLogs('spawned compiler process')).toBe(1);
    });
});
