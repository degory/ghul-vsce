import { execSync } from 'child_process';
import { readdirSync } from 'fs';

export function generateAssembliesJson(workspace: string) {
    let files = readdirSync(workspace);

    if (files.find(file => file.endsWith(".ghulproj"))) {
        console.log("generate .assemblies.json...");
        console.log(execSync("dotnet build -verbosity:minimal -t:GenerateAssembliesJson").toString());
    }
}
