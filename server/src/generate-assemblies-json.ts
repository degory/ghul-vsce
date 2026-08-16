import { execFile } from 'child_process';
import { readdirSync } from 'fs';
import { log } from './log';

const COMMAND = "dotnet";

// An explicit -t: replaces the default target, so this runs
// GenerateAssembliesJson and the chain it depends on —
// FindReferenceAssembliesForReferences, ResolveReferences,
// ResolveProjectReferences — and stops there. CoreCompile is not in that
// chain, so the project being analysed is resolved but never compiled, which
// is what we want: the analyser reads that project's sources itself and has no
// use for its output assembly.
//
// ResolveProjectReferences does build each referenced project, and that is
// also what we want. A reference is only ever visible to the analyser as
// metadata it reflects over, so an assembly that is absent or out of date is
// not a slower start-up, it is the wrong answer: the analyser reports symbols
// added since the last build as not found, and nothing downstream can tell
// that from the truth.
const ARGUMENTS = ["build", "-verbosity:minimal", "-t:GenerateAssembliesJson"];

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

// Build the referenced projects and write the resolved reference paths to
// .assemblies.json. Returns a human-readable problem description if that
// failed, or null on success / nothing-to-do. Never rejects: a broken
// .ghulproj is a degraded load to be reported, not a reason to abandon the
// rest of the startup.
export function generateAssembliesJson(workspace: string): Promise<string | null> {
    return run(workspace, ARGUMENTS, "building project references");
}
