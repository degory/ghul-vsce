import { execSync } from 'child_process';
import { log } from './log';
import { existsSync } from 'fs';

export function restoreDotNetTools(workspace: string) {
    if (existsSync(workspace + '/.config/dotnet-tools.json')) {
        log("restoring .NET tools...");
        log(execSync("dotnet tool restore").toString());
        log("finished restoring .NET tools")
    } else {
        log("no .config/dotnet-tools.json found: won't attempt to restore .NET tools");
    }
}
