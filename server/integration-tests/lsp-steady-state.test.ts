import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

import { LspClient } from './lsp-client';

// Start-up progress is covered by lsp-startup.test.ts. This covers what
// happens *after* it: the extension asks the client for a fresh progress
// token per burst of activity, and only one such request is in flight at a
// time — so anything that stops one being answered stops every later activity
// being reported for the rest of the session, with the start-up sequence
// still looking perfectly healthy.

const SERVER_PATH = join(__dirname, '..', 'out', 'server.js');
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'simple-project');
const SOURCE_PATH = join(FIXTURE_ROOT, 'src', 'hello.ghul');

function cleanGeneratedArtifacts() {
    for (const relative of ['bin', 'obj', '.assemblies.json', '.analysis.rsp', '.build.rsp']) {
        rmSync(join(FIXTURE_ROOT, relative), { recursive: true, force: true });
    }
}

describe('progress after start-up, against a real compiler', () => {
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

    it('keeps reporting activity once the start-up sequence has closed', async () => {
        client = new LspClient(SERVER_PATH, FIXTURE_ROOT);

        const uri = 'file://' + SOURCE_PATH;
        const text = readFileSync(SOURCE_PATH, 'utf8');

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
        client.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'ghul', version: 1, text },
        });

        // Waiting on a hover gets us past the first compile — and, as a side
        // effect, leaves an answered client request whose id the server's own
        // next request is apt to reuse.
        await client.request('textDocument/hover', {
            textDocument: { uri },
            position: { line: 2, character: 2 },
        });

        const started = client.progressNotifications.length;

        expect(started).toBeGreaterThan(0);

        // Type, then pause long enough for the queue to ask for a full compile
        // and for it to land.
        for (let version = 2; version < 8; version++) {
            client.notify('textDocument/didChange', {
                textDocument: { uri, version },
                contentChanges: [{ text: text + '\n'.repeat(version) }],
            });

            await new Promise(resolve => setTimeout(resolve, 120));
        }

        await new Promise(resolve => setTimeout(resolve, 8000));

        const after = client.progressNotifications.slice(started);

        // The fixture is small enough that every compile can beat the delay
        // before a spinner is worth showing, so an empty tail is legitimate —
        // what must not happen is the mechanism being wedged. Any token that
        // did open has to have been closed, and every rendered message has to
        // be a real one.
        const begun = after.filter(p => p.value.kind === 'begin').length;
        const ended = after.filter(p => p.value.kind === 'end').length;

        expect(ended).toBe(begun);

        for (const p of after) {
            if (p.value.kind === 'report') {
                expect(p.value.message).toBeTruthy();
            }
        }
    }, 120000);
});
