import { execSync } from 'child_process';
import { log } from './log';
import { existsSync } from 'fs';

// Returns a human-readable problem description if the restore failed, or null
// on success / nothing-to-do. execSync throws on a non-zero exit; callers run
// this during initialize(), so a thrown error there crashes the whole load.
export function restoreDotNetTools(workspace: string): string | null {
    if (!existsSync(workspace + '/.config/dotnet-tools.json')) {
        log("no .config/dotnet-tools.json found: won't attempt to restore .NET tools");
        return null;
    }

    log("restoring .NET tools...");

    try {
        log(execSync("dotnet tool restore").toString());
        log("finished restoring .NET tools");
        return null;
    } catch (e) {
        let problem = `could not restore .NET tools: ${e instanceof Error ? e.message : String(e)}`;
        log(problem);
        return problem;
    }
}
