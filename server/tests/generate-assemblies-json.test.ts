import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';

import { generateAssembliesJson } from '../src/generate-assemblies-json';

// child_process.execFile is non-configurable in modern Node, so spyOn fails.
// Mock the whole module but pass through the rest:
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execFile: jest.fn((_command, _args, _options, callback) => callback(null, '', '')),
}));

describe('generateAssembliesJson', () => {
    let workspace: string;

    beforeEach(() => {
        workspace = mkdtempSync(join(tmpdir(), 'ghul-vsce-asm-'));
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

        await expect(generateAssembliesJson(workspace)).resolves.toBeNull();

        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith(
            'dotnet',
            ['build', '-verbosity:minimal', '-t:GenerateAssembliesJson'],
            { cwd: workspace },
            expect.any(Function)
        );

        const [, args] = (execFile as unknown as jest.Mock).mock.calls[0];

        expect(args).not.toContain('-p:BuildProjectReferences=false');
    });

    // An explicit -t: stops at ResolveReferences, so the project being
    // analysed is resolved but never compiled. Its output assembly is of no
    // use to an analyser that reads its sources directly, and compiling it
    // would put a full build on every start-up.
    it('does not build the project being analysed', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        await generateAssembliesJson(workspace);

        const [, args] = (execFile as unknown as jest.Mock).mock.calls[0];

        expect(args).toContain('-t:GenerateAssembliesJson');
    });

    it('does nothing when no .ghulproj is present', async () => {
        await expect(generateAssembliesJson(workspace)).resolves.toBeNull();

        expect(execFile).not.toHaveBeenCalled();
    });

    it('ignores non-ghulproj files in the workspace', async () => {
        writeFileSync(join(workspace, 'other.csproj'), '<Project/>');
        writeFileSync(join(workspace, 'README.md'), '');

        await expect(generateAssembliesJson(workspace)).resolves.toBeNull();

        expect(execFile).not.toHaveBeenCalled();
    });

    it('reports a failing build rather than rejecting', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        (execFile as unknown as jest.Mock).mockImplementationOnce(
            (_command, _args, _options, callback) => callback(new Error('MSB1009'), '', '')
        );

        await expect(generateAssembliesJson(workspace)).resolves.toContain('MSB1009');
    });
});
