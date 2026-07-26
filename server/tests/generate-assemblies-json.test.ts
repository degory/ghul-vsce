import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';

import { generateAssembliesJson, buildReferencedAssemblies } from '../src/generate-assemblies-json';

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

    it('resolves reference paths without building the referenced projects', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        await expect(generateAssembliesJson(workspace)).resolves.toBeNull();

        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith(
            'dotnet',
            [
                'build',
                '-verbosity:minimal',
                '-t:GenerateAssembliesJson',
                '-p:BuildProjectReferences=false',
            ],
            { cwd: workspace },
            expect.any(Function)
        );
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

describe('buildReferencedAssemblies', () => {
    let workspace: string;

    beforeEach(() => {
        workspace = mkdtempSync(join(tmpdir(), 'ghul-vsce-asm-'));
        (execFile as unknown as jest.Mock).mockClear();
    });

    afterEach(() => {
        try { rmSync(workspace, { recursive: true, force: true }); } catch { /* swallow */ }
    });

    it('builds the referenced projects, unlike the startup path', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        await expect(buildReferencedAssemblies(workspace)).resolves.toBeNull();

        expect(execFile).toHaveBeenCalledWith(
            'dotnet',
            ['build', '-verbosity:minimal', '-t:GenerateAssembliesJson'],
            { cwd: workspace },
            expect.any(Function)
        );
    });
});
