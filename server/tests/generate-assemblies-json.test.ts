import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

import { generateAssembliesJson } from '../src/generate-assemblies-json';

// child_process.execSync is non-configurable in modern Node, so spyOn fails.
// Mock the whole module but pass through the rest:
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execSync: jest.fn(() => Buffer.from('')),
}));

describe('generateAssembliesJson', () => {
    let workspace: string;

    beforeEach(() => {
        workspace = mkdtempSync(join(tmpdir(), 'ghul-vsce-asm-'));
        (execSync as jest.Mock).mockClear();
    });

    afterEach(() => {
        try { rmSync(workspace, { recursive: true, force: true }); } catch { /* swallow */ }
    });

    it('runs dotnet build in the workspace directory when a .ghulproj is present', () => {
        // The cwd matters for multi-root: without it the build would target
        // whichever .ghulproj happens to be in the server process's cwd
        // (typically the first workspace's) and write .assemblies.json
        // there too, leaving the second workspace with no -a flags and
        // hundreds of spurious "unknown type" errors.
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        generateAssembliesJson(workspace);

        expect(execSync).toHaveBeenCalledTimes(1);
        expect(execSync).toHaveBeenCalledWith(
            'dotnet build -verbosity:minimal -t:GenerateAssembliesJson',
            { cwd: workspace }
        );
    });

    it('does nothing when no .ghulproj is present', () => {
        generateAssembliesJson(workspace);

        expect(execSync).not.toHaveBeenCalled();
    });

    it('ignores non-ghulproj files in the workspace', () => {
        writeFileSync(join(workspace, 'other.csproj'), '<Project/>');
        writeFileSync(join(workspace, 'README.md'), '');

        generateAssembliesJson(workspace);

        expect(execSync).not.toHaveBeenCalled();
    });
});
