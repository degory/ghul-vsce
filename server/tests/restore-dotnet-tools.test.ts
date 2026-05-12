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

    it('runs dotnet tool restore when the manifest exists', () => {
        mkdirSync(join(workspace, '.config'));
        writeFileSync(join(workspace, '.config/dotnet-tools.json'), '{"version":1}');

        restoreDotNetTools(workspace);

        expect(execSync).toHaveBeenCalledWith('dotnet tool restore');
    });

    it('does nothing when the manifest is missing', () => {
        restoreDotNetTools(workspace);

        expect(execSync).not.toHaveBeenCalled();
    });
});
