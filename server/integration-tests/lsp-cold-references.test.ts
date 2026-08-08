import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import { LspClient } from './lsp-client';

// A workspace whose referenced projects have never been built — a fresh
// clone, a new Codespace — is the one case where the extension can be made to
// set itself up several times over for a single event: it builds the
// referenced project itself, and the assembly that build produces is also the
// thing it asked the client to watch for. Both routes then report the same
// news, and each one restores tools, regenerates .assemblies.json and
// replaces the analyser: tens of seconds each, and a compiler that starts
// again from cold every time.
//
// Only reproducible against a real client and a real build, because the
// second trigger is a file the build writes and an editor reports. Same
// requirements as the other tests in this tier: `dotnet` on PATH, network
// access for the tool restore, and the server built first.

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

    it('sets up once for the cold start and once for the assembly its build produced', async () => {
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
            message => message.includes('finished building referenced assemblies'),
            180000,
            'the referenced project build finishing'
        );

        expect(existsSync(LIBRARY_PATH)).toBe(true);

        // The build's completion re-runs setup on the now-complete reference
        // set. That is the one repeat this start-up is entitled to.
        await client.waitForLog(
            message => message.includes('finished generating .assemblies.json') &&
                client.countLogs('generating .assemblies.json...') > 1,
            120000,
            'setup running again on the built reference set'
        );

        // Long enough for a re-initialize left pending by the client's report
        // of the new assembly to have fired: the change tracker debounces
        // that by five seconds.
        await new Promise(resolve => setTimeout(resolve, 15000));

        expect(client.countLogs('restoring .NET tools...')).toBe(2);
        expect(client.countLogs('generating .assemblies.json...')).toBe(2);
        expect(client.countLogs('building referenced assemblies...')).toBe(1);
        expect(client.countLogs('spawned compiler process')).toBe(2);

        // The reference set is what changed, so the second analyser has to be
        // the one that can see the library — otherwise setup ran twice and
        // achieved nothing.
        const hover = await client.request('textDocument/hover', {
            textDocument: { uri },
            position: { line: 6, character: 32 },
        });

        expect(JSON.stringify(hover)).toContain('THING');
    });
});
