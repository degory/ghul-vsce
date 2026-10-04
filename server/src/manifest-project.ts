import { execFile, spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { parse } from 'shell-quote';

import { log } from './log';

// A project described by a ghul-project.json manifest rather than a .ghulproj.
// The ghul command-line tool reads the manifest; the extension never builds
// one, and gets everything it needs from two of the tool's commands:
//
//     ghul project response-file --output <path> --source-globs <path>
//     ghul project compiler
//
// which give the same response file and source globs file a .ghulproj build
// writes, and the command that runs the compiler the project builds with.

export const MANIFEST = 'ghul-project.json';
export const LOCKFILE = 'ghul-project.lock.json';

const COMMAND = 'ghul';

// A folder holding a .ghulproj is a .ghulproj project whether or not it also
// holds a manifest: the manifest is only read when the ghul tool is asked to
// build.
export function isManifestProject(workspace: string): boolean {
    let entries: string[];

    try {
        entries = readdirSync(workspace);
    } catch {
        return false;
    }

    return entries.includes(MANIFEST) && !entries.some(e => e.endsWith('.ghulproj'));
}

// The manifest allows // comments and trailing commas, which JSON.parse does
// not. Strings are copied through untouched, so a // inside one survives.
function withoutCommentsOrTrailingCommas(text: string): string {
    let result = '';
    let i = 0;

    while (i < text.length) {
        let c = text[i];

        if (c === '"') {
            let end = i + 1;

            while (end < text.length && text[end] !== '"') {
                end += text[end] === '\\' ? 2 : 1;
            }

            result += text.slice(i, end + 1);
            i = end + 1;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
        } else {
            result += c;
            i++;
        }
    }

    return result.replace(/,(\s*[}\]])/g, '$1');
}

// The target to analyse for: none when the manifest lists one target or
// none, since the tool takes the only one by itself, and otherwise the first
// listed, which the tool would refuse to choose. Null too when the manifest
// cannot be read: the tool reports that itself, better than this could.
export function targetToAnalyse(workspace: string): string | null {
    try {
        let text = readFileSync(join(workspace, MANIFEST), 'utf-8').replace(/^﻿/, '');
        let targets = JSON.parse(withoutCommentsOrTrailingCommas(text))?.targets;

        if (Array.isArray(targets) && targets.length > 1 && typeof targets[0] === 'string') {
            return targets[0];
        }
    } catch {
        // reported by the ghul tool when it reads the same manifest
    }

    return null;
}

function describeFailure(what: string, e: unknown, stderr?: string): string {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return `the ghul command-line tool is needed to open a ${MANIFEST} project, and was not found`;
    }

    let detail = stderr?.trim() || (e instanceof Error ? e.message : String(e));

    return `could not ${what} for ${MANIFEST}: ${detail}`;
}

// Writes the response file and the source globs file for a manifest project.
// Resolves to a problem to report, or null; never rejects.
export function generateManifestResponseFile(
    workspace: string,
    response_file: string,
    source_globs_file: string
): Promise<string | null> {
    // So that whether each file is there afterwards says whether this run
    // wrote it, rather than whether some earlier one did.
    rmSync(response_file, { force: true });
    rmSync(source_globs_file, { force: true });

    let args = ['project', 'response-file', '--output', response_file, '--source-globs', source_globs_file];
    let target = targetToAnalyse(workspace);

    if (target) {
        args.push('--target', target);
    }

    log(`resolving compiler options with '${COMMAND} ${args.join(' ')}'...`);

    return new Promise(resolve => {
        execFile(COMMAND, args, { cwd: workspace }, (error, _stdout, stderr) => {
            if (error) {
                let problem = describeFailure('resolve the compiler options', error, stderr);
                log(problem);
                resolve(problem);
                return;
            }

            resolve(existsSync(response_file) ? null : `${COMMAND} wrote no response file for ${MANIFEST}`);
        });
    });
}

// The command that runs the compiler the project builds with. Asked at every
// setup rather than kept: with no compiler named in the manifest it is the
// newest installed, so it can change when a compiler is installed.
export function manifestCompiler(workspace: string): { compiler?: string[], problem?: string } {
    let result = spawnSync(COMMAND, ['project', 'compiler'], { encoding: 'utf-8', cwd: workspace });

    if (result.error || result.status !== 0) {
        return { problem: describeFailure('find the compiler', result.error ?? new Error(`exit status ${result.status}`), result.stderr) };
    }

    let line = result.stdout.split(/\r?\n/).find(l => l.trim().length > 0);

    if (!line) {
        return { problem: `${COMMAND} named no compiler for ${MANIFEST}` };
    }

    let compiler = parse(line.trim()).map(e => e.toString());

    log(`will use compiler '${line.trim()}' named by ${COMMAND}`);

    return { compiler };
}
