import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

import { LspClient } from './lsp-client';

// A project with no <GhulCompiler> in its .ghulproj resolves the compiler
// through the local tool manifest, which spawns `dotnet tool run
// ghul-compiler`. That spelling parses the rest of the command line
// MSBuild-style — including `@file` response-file expansion, one argument
// per line — and .analysis.rsp is written as a single line, so without the
// `--` separator dotnet expanded the whole rsp into one giant argument: the
// analysis flag was never seen, the compiler fell into batch mode, failed
// with "no entry point declared", and the extension restart-looped it. This
// fixture is the only one without <GhulCompiler> (every other fixture and
// repo pins it, which is exactly why nothing else caught this), so this
// test is the one place the manifest resolution path is exercised against a
// real compiler.
//
// Same requirements as the other tests in this tier: `dotnet` on PATH,
// network access for the tool restore, and the server built first.

const SERVER_PATH = join(__dirname, '..', 'out', 'server.js');
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'manifest-project');
const SOURCE_PATH = join(FIXTURE_ROOT, 'src', 'hello.ghul');

function cleanGeneratedArtifacts() {
    for (const relative of ['bin', 'obj', '.assemblies.json', '.analysis.rsp', '.build.rsp', '.ghul-options.json']) {
        rmSync(join(FIXTURE_ROOT, relative), { recursive: true, force: true });
    }
}

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

describe('start-up with the compiler resolved from the tool manifest (no <GhulCompiler>)', () => {
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

    it('starts the analyser and answers a hover through `dotnet tool run`', async () => {
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

        // Hovering over the declaration of `greet`. When the rsp is
        // mangled, the analyser never comes up and this never resolves
        // (the server holds the request until the analyser is ready).
        const hover = await withDiagnostics(client.request('textDocument/hover', {
            textDocument: { uri },
            position: { line: 2, character: 2 },
        }), client, 'hover', 60000);

        if (hover === null) {
            throw new Error(
                `hover resolved null.\n` +
                `logs:\n${client.logMessages.join('\n')}\n` +
                `stderr:\n${client.stderr.join('')}`
            );
        }
        expect(JSON.stringify(hover)).toContain('greet');
    });
});
