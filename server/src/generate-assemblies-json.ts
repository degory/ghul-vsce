import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { log } from './log';

// Returns a human-readable problem description if generation failed, or null
// on success / nothing-to-do. A broken .ghulproj makes `dotnet build` exit
// non-zero, and execSync turns that into a thrown error — which, uncaught,
// crashes initialize() and leaves the extension restarting in a loop.
export function generateAssembliesJson(workspace: string): string | null {
    let files = readdirSync(workspace);

    if (!files.find(file => file.endsWith(".ghulproj"))) {
        log("no .ghulproj found: cannot generate .assemblies.json");
        return null;
    }

    log("generating .assemblies.json...");

    try {
        log(execSync("dotnet build -verbosity:minimal -t:GenerateAssembliesJson", { cwd: workspace }).toString());
        log("finished generating .assemblies.json");
        return null;
    } catch (e) {
        let problem = `could not generate .assemblies.json — the ghūl project may be missing or invalid: ` +
            `${e instanceof Error ? e.message : String(e)}`;
        log(problem);
        return problem;
    }
}
