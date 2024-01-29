import { execSync } from 'child_process';
import { log } from './log';
import { existsSync } from 'fs';

export function restoreDotNetTools(workspace: string) {
    if (existsSync(workspace + '/.config/dotnet-tools.json')) {
        log("restore .NET tools...");
        log(execSync("dotnet tool restore").toString());
    } else {
        log("no .config/dotnet-tools.json found: won't attempt to restore .NET tools");
    }
}
