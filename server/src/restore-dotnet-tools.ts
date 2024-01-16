import { execSync } from 'child_process';
import { log } from 'console';
import { existsSync } from 'fs';

export function restoreDotNetTools(workspace: string) {
    log("restore .NET tools");

    if (existsSync(workspace + '/.config/dotnet-tools.json')) {
        console.log("restore .NET tools...");
        console.log(execSync("dotnet tool restore").toString());
    }
}
