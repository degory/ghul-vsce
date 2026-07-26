import { execSync, execFile } from 'child_process';
import { readdirSync } from 'fs';
import { log } from './log';

const COMMAND = "dotnet";

const ARGUMENTS = ["build", "-verbosity:minimal", "-t:GenerateAssembliesJson"];

// GenerateAssembliesJson depends on FindReferenceAssembliesForReferences, which
// pulls in ResolveProjectReferences and so builds every referenced project just
// to learn where its output assembly will be. The paths it writes are the same
// either way, so suppressing that build produces an identical .assemblies.json
// at a fraction of the cost — at the price of the referenced outputs not
// existing until something else builds them.
const WITHOUT_REFERENCE_BUILD = [...ARGUMENTS, "-p:BuildProjectReferences=false"];

function describeFailure(e: unknown): string {
    return `could not generate .assemblies.json — the ghūl project may be missing or invalid: ` +
        `${e instanceof Error ? e.message : String(e)}`;
}

function hasProject(workspace: string): boolean {
    let files = readdirSync(workspace);

    if (!files.find(file => file.endsWith(".ghulproj"))) {
        log("no .ghulproj found: cannot generate .assemblies.json");
        return false;
    }

    return true;
}

// Resolve the referenced assembly paths without building any of them. Returns a
// human-readable problem description if generation failed, or null on success /
// nothing-to-do. A broken .ghulproj makes `dotnet build` exit non-zero, and
// execSync turns that into a thrown error — which, uncaught, crashes
// initialize() and leaves the extension restarting in a loop.
export function generateAssembliesJson(workspace: string): string | null {
    if (!hasProject(workspace)) {
        return null;
    }

    log("generating .assemblies.json...");

    try {
        log(execSync([COMMAND, ...WITHOUT_REFERENCE_BUILD].join(" "), { cwd: workspace }).toString());
        log("finished generating .assemblies.json");
        return null;
    } catch (e) {
        let problem = describeFailure(e);
        log(problem);
        return problem;
    }
}

// Build the referenced projects so their output assemblies exist, and refresh
// .assemblies.json from the result. Runs detached from whatever asked for it:
// the analyser is already up by this point and running on the assemblies that
// were present, so this only has to finish eventually, not promptly.
export function buildReferencedAssemblies(workspace: string): Promise<string | null> {
    if (!hasProject(workspace)) {
        return Promise.resolve(null);
    }

    log("building referenced assemblies...");

    return new Promise(resolve => {
        execFile(COMMAND, ARGUMENTS, { cwd: workspace }, (error, stdout) => {
            if (error) {
                let problem = describeFailure(error);
                log(problem);
                resolve(problem);
                return;
            }

            log(stdout);
            log("finished building referenced assemblies");
            resolve(null);
        });
    });
}
