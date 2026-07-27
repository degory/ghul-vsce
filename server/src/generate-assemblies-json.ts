import { execFile } from 'child_process';
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

function run(workspace: string, args: string[], description: string): Promise<string | null> {
    if (!hasProject(workspace)) {
        return Promise.resolve(null);
    }

    log(`${description}...`);

    return new Promise(resolve => {
        execFile(COMMAND, args, { cwd: workspace }, (error, stdout) => {
            if (error) {
                let problem = describeFailure(error);
                log(problem);
                resolve(problem);
                return;
            }

            log(stdout);
            log(`finished ${description}`);
            resolve(null);
        });
    });
}

// Resolve the referenced assembly paths without building any of them. Returns a
// human-readable problem description if generation failed, or null on success /
// nothing-to-do. Never rejects: a broken .ghulproj is a degraded load to be
// reported, not a reason to abandon the rest of the startup.
export function generateAssembliesJson(workspace: string): Promise<string | null> {
    return run(workspace, WITHOUT_REFERENCE_BUILD, "generating .assemblies.json");
}

// Build the referenced projects so their output assemblies exist, and refresh
// .assemblies.json from the result. Runs detached from whatever asked for it:
// the analyser is already up by this point and running on the assemblies that
// were present, so this only has to finish eventually, not promptly.
export function buildReferencedAssemblies(workspace: string): Promise<string | null> {
    return run(workspace, ARGUMENTS, "building referenced assemblies");
}
