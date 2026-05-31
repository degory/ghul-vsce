import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

import { restoreDotNetTools } from '../src/restore-dotnet-tools';

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execSync: jest.fn(() => Buffer.from('')),
}));

describe('restoreDotNetTools', () => {
    let workspace: string;

    beforeEach(() => {
        workspace = mkdtempSync(join(tmpdir(), 'ghul-vsce-tools-'));
        (execSync as jest.Mock).mockClear();
    });

    afterEach(() => {
        try { rmSync(workspace, { recursive: true, force: true }); } catch { /* swallow */ }
    });

    it('runs dotnet tool restore in the workspace directory when the manifest exists', () => {
        // Without cwd, restore runs against whichever manifest happens to
        // live in the server process's cwd — fine when there is only one
        // workspace, but in a multi-root session both workspaces end up
        // restoring the same first-workspace tools.
        mkdirSync(join(workspace, '.config'));
        writeFileSync(join(workspace, '.config/dotnet-tools.json'), '{"version":1}');

        restoreDotNetTools(workspace);

        expect(execSync).toHaveBeenCalledWith('dotnet tool restore', { cwd: workspace });
    });

    it('does nothing when the manifest is missing', () => {
        restoreDotNetTools(workspace);

        expect(execSync).not.toHaveBeenCalled();
    });
});
