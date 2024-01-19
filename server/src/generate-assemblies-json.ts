import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { log } from './log';

export function generateAssembliesJson(workspace: string) {
    let files = readdirSync(workspace);

    if (files.find(file => file.endsWith(".ghulproj"))) {
        log("generate .assemblies.json...");
        log(execSync("dotnet build -verbosity:minimal -t:GenerateAssembliesJson").toString());
    } else {
        log("no .guleproj so will not attempt to generate .assemblies.json");
    }
}
