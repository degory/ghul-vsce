import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';

import { generateResponseFile } from '../src/generate-response-file';

// child_process.execFile is non-configurable in modern Node, so spyOn fails.
// Mock the whole module but pass through the rest:
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execFile: jest.fn((_command, _args, _options, callback) => callback(null, '', '')),
}));

describe('generateResponseFile', () => {
    let workspace: string;
    let response_file: string;
    let source_globs_file: string;

    beforeEach(() => {
        workspace = mkdtempSync(join(tmpdir(), 'ghul-vsce-rsp-'));
        response_file = join(workspace, 'project.rsp');
        source_globs_file = join(workspace, 'source-globs.txt');
        (execFile as unknown as jest.Mock).mockClear();
    });

    afterEach(() => {
        try { rmSync(workspace, { recursive: true, force: true }); } catch { /* swallow */ }
    });

    // The analyser only ever sees a reference as metadata it reflects over, so
    // a reference left unbuilt is not a slower start-up, it is an analyser
    // answering from whatever was last built. Suppressing this build is what
    // made symbols added to a referenced project since its last build report
    // as not found, so the flag that would do it is worth pinning against.
    it('builds the referenced projects while resolving their paths', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        await expect(generateResponseFile(workspace, response_file, source_globs_file)).resolves.toBeNull();

        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith(
            'dotnet',
            [
                'build',
                '-verbosity:minimal',
                '-t:GenerateGhulResponseFile',
                `-p:GhulResponseFile=${response_file}`,
                `-p:GhulSourceGlobsFile=${source_globs_file}`
            ],
            { cwd: workspace },
            expect.any(Function)
        );

        const [, args] = (execFile as unknown as jest.Mock).mock.calls[0];

        expect(args).not.toContain('-p:BuildProjectReferences=false');
    });

    // Whether each file is there afterwards is how the caller tells a runtime
    // with the target from one without it, so files left by an earlier run
    // would answer for a run that wrote nothing.
    it('removes any files left by an earlier run before building', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');
        writeFileSync(response_file, '-a /stale.dll');
        writeFileSync(source_globs_file, '/stale/**/*.ghul');

        await generateResponseFile(workspace, response_file, source_globs_file);

        expect(existsSync(response_file)).toBe(false);
        expect(existsSync(source_globs_file)).toBe(false);
    });

    it('does nothing when no .ghulproj is present', async () => {
        await expect(generateResponseFile(workspace, response_file, source_globs_file)).resolves.toBeNull();

        expect(execFile).not.toHaveBeenCalled();
    });

    it('ignores non-ghulproj files in the workspace', async () => {
        writeFileSync(join(workspace, 'other.csproj'), '<Project/>');
        writeFileSync(join(workspace, 'README.md'), '');

        await expect(generateResponseFile(workspace, response_file, source_globs_file)).resolves.toBeNull();

        expect(execFile).not.toHaveBeenCalled();
    });

    it('reports a failing build rather than rejecting', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        (execFile as unknown as jest.Mock).mockImplementationOnce(
            (_command, _args, _options, callback) => callback(new Error('MSB1009'), '', '')
        );

        await expect(generateResponseFile(workspace, response_file, source_globs_file)).resolves.toContain('MSB1009');
    });
});
