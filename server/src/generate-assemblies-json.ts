import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { log } from './log';

export function generateAssembliesJson(workspace: string) {
    let files = readdirSync(workspace);

    if (files.find(file => file.endsWith(".ghulproj"))) {
        log("generating .assemblies.json...");
        log(execSync("dotnet build -verbosity:minimal -t:GenerateAssembliesJson").toString());
        log("finished generating .assemblies.json");
    } else {
        log("no .ghulproj found: cannot generate .assemblies.json");
    }
}
