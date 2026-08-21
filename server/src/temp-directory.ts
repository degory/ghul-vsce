import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { log } from './log';

// A directory of this server's own, holding the files it and the build
// generate on the way to a compiler command line. They used to be written into
// the project, where nothing owned them: a second editor opened on one folder
// overwrote the first's, and anything that outlived a crash stayed in the
// checkout until someone noticed it. Here a crash leaves them where the system
// reaps them, and the name mkdtemp picks keeps two servers apart.
//
// Created on first use rather than up front, so a folder that turns out not to
// be a ghūl project never makes one.
export class TempDirectory {
    private directory: string | null = null;

    path(name: string): string {
        this.directory ??= mkdtempSync(path.join(tmpdir(), 'ghul-lsp-'));

        return path.join(this.directory, name);
    }

    dispose() {
        if (!this.directory) {
            return;
        }

        const directory = this.directory;
        this.directory = null;

        try {
            rmSync(directory, { recursive: true, force: true });
        } catch (e) {
            log(`could not remove ${directory}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
