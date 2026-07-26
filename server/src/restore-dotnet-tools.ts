import { execFile } from 'child_process';
import { log } from './log';
import { existsSync } from 'fs';

// Returns a human-readable problem description if the restore failed, or null
// on success / nothing-to-do. Never rejects: a broken manifest is a degraded
// load to be reported, not a reason to abandon the rest of the startup.
export function restoreDotNetTools(workspace: string): Promise<string | null> {
    if (!existsSync(workspace + '/.config/dotnet-tools.json')) {
        log("no .config/dotnet-tools.json found: won't attempt to restore .NET tools");
        return Promise.resolve(null);
    }

    log("restoring .NET tools...");

    return new Promise(resolve => {
        execFile("dotnet", ["tool", "restore"], { cwd: workspace }, (error, stdout) => {
            if (error) {
                let problem = `could not restore .NET tools: ${error.message}`;
                log(problem);
                resolve(problem);
                return;
            }

            log(stdout);
            log("finished restoring .NET tools");
            resolve(null);
        });
    });
}
