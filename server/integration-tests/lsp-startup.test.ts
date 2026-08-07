import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

import { LspClient } from './lsp-client';

// The real end-to-end path for #152 (make the extension usable while the
// project is still loading) and #154 (surface start-up progress via a status
// bar item): a plain LSP client over stdio, driving the actual compiled
// server.js against a real ghūl project with a real ghul.compiler child
// underneath. Every other test in this repo mocks child_process; this one
// deliberately does not, because both bugs only reproduce once a real
// analyser is actually involved end to end.
//
// Needs `dotnet` on PATH, network access for tool restore, and the server
// built first (`npm run webpack` from the repo root). Deliberately spawns the
// real webpacked bundle at server/out/server.js — the exact artifact VS Code
// loads — rather than the plain tsc output, which has no node_modules next
// to it and only resolves once installServerIntoExtension has wired that up.

const SERVER_PATH = join(__dirname, '..', 'out', 'server.js');
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'simple-project');
const SOURCE_PATH = join(FIXTURE_ROOT, 'src', 'hello.ghul');

function cleanGeneratedArtifacts() {
    for (const relative of ['bin', 'obj', '.assemblies.json', '.analysis.rsp', '.build.rsp']) {
        rmSync(join(FIXTURE_ROOT, relative), { recursive: true, force: true });
    }
}

// A request that never resolves would otherwise hang until Jest's own
// testTimeout, reporting nothing but "Exceeded timeout" with no way to tell
// which step got stuck or why. This surfaces the server's own log/stderr
// output in the failure message instead.
function withDiagnostics<T>(promise: Promise<T>, client: LspClient, step: string, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(
            () => reject(new Error(
                `${step} did not resolve within ${ms}ms.\n` +
                `logs:\n${client.logMessages.join('\n')}\n` +
                `stderr:\n${client.stderr.join('')}`
            )),
            ms
        ).unref()),
    ]);
}

describe('language server start-up against a real compiler (no mocks, no VS Code)', () => {
    beforeAll(() => {
        if (!existsSync(SERVER_PATH)) {
            throw new Error(
                `${SERVER_PATH} does not exist — build it first: ` +
                `npm run genversion && webpack --mode production --config ./server/webpack.config.js`
            );
        }
    });

    let client: LspClient;

    beforeEach(() => {
        cleanGeneratedArtifacts();
    });

    afterEach(async () => {
        await client?.dispose();
        cleanGeneratedArtifacts();
    });

    it('reports progress through setup and the first compile, and holds a hover asked before the analyser is ready', async () => {
        client = new LspClient(SERVER_PATH, FIXTURE_ROOT);

        const uri = 'file://' + SOURCE_PATH;

        await withDiagnostics(client.request('initialize', {
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
        }), client, 'initialize', 30000);

        client.notify('initialized', {});

        client.notify('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: 'ghul',
                version: 1,
                text: readFileSync(SOURCE_PATH, 'utf8'),
            },
        });

        // Sent before the analyser can possibly have compiled anything yet —
        // exactly the "tried once during start-up" case #152 fixed. Hovering
        // over the declaration of `greet`.
        const hover = await withDiagnostics(client.request('textDocument/hover', {
            textDocument: { uri },
            position: { line: 2, character: 2 },
        }), client, 'hover', 60000);

        // A null/empty result here is the bug #152 fixed: the client would
        // cache it and never ask again until the document changes.
        expect(hover).not.toBeNull();
        expect(JSON.stringify(hover)).toContain('greet');

        const progressKinds = client.progressNotifications.map(p => p.value.kind);
        expect(progressKinds[0]).toBe('begin');
        expect(progressKinds[progressKinds.length - 1]).toBe('end');

        // The reporter is created asynchronously, so the earliest message can
        // arrive folded into begin rather than as its own report.
        const messages = client.progressNotifications
            .filter(p => p.value.kind === 'begin' || p.value.kind === 'report')
            .map(p => p.value.message);

        // The setup phase (#152/#154) and the first-compile phase both have
        // to show up — not just the setup, which ends well before the
        // analyser can answer anything.
        expect(messages).toContain('resolving project references');
        expect(messages).toContain('analysing project');
    });
});
