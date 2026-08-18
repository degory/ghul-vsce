import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';

import { generateGhulOptionsJson } from '../src/generate-ghul-options-json';

// child_process.execFile is non-configurable in modern Node, so spyOn fails.
// Mock the whole module but pass through the rest:
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execFile: jest.fn((_command, _args, _options, callback) => callback(null, '', '')),
}));

describe('generateGhulOptionsJson', () => {
    let workspace: string;

    beforeEach(() => {
        workspace = mkdtempSync(join(tmpdir(), 'ghul-vsce-opts-'));
        (execFile as unknown as jest.Mock).mockClear();
    });

    afterEach(() => {
        try { rmSync(workspace, { recursive: true, force: true }); } catch { /* swallow */ }
    });

    it('runs GenerateGhulOptionsJson against the project', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        await generateGhulOptionsJson(workspace);

        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith(
            'dotnet',
            ['build', '-verbosity:minimal', '-t:GenerateGhulOptionsJson'],
            { cwd: workspace },
            expect.any(Function)
        );
    });

    it('does nothing when no .ghulproj is present', async () => {
        await generateGhulOptionsJson(workspace);

        expect(execFile).not.toHaveBeenCalled();
    });

    // A project pinned to a ghul.runtime older than 14.1.0 has no
    // GenerateGhulOptionsJson target, and MSBuild reports an unknown target
    // as a build failure. That is the ordinary case for most existing
    // projects, not a problem to surface - getGhulConfig's XML fallback
    // covers it, so failure here never rejects and is never reported to a
    // caller as a load-time problem the way generateAssembliesJson's is.
    it('never rejects on a failing build', async () => {
        writeFileSync(join(workspace, 'test.ghulproj'), '<Project/>');

        (execFile as unknown as jest.Mock).mockImplementationOnce(
            (_command, _args, _options, callback) => callback(new Error('MSB4057: target not found'), '', '')
        );

        await expect(generateGhulOptionsJson(workspace)).resolves.toBeUndefined();
    });
});
