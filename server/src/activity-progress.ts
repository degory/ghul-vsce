import { Connection, WorkDoneProgressServerReporter } from 'vscode-languageserver';

import { log } from './log';

// The activities the user is told about, in the words they are told them in.
// Each names a thing being done, not the mechanism doing it: the user wants to
// know the project is being analysed, not that the extension is waiting on a
// compiler to tell it so.
export enum Activity {
    // Per-workspace setup: tool restore, reference resolution.
    Setup = 'setup',
    // The compiler child, from spawn through its first compile of the project.
    Compiler = 'compiler',
    // Building referenced projects whose output assemblies are absent.
    References = 'references',
    // A full compile of the project after a lull in editing.
    Compile = 'compile',
    // The analyser sampling (and so collecting) its heap.
    Heap = 'heap',
}

// One progress notification per workspace, shared by every activity that wants
// to say something in it.
//
// Activities overlap freely — a full compile can start while referenced
// projects are still building — and LSP progress is per-token, so a reporter
// per activity would stack several spinners saying different things at once.
// Instead each activity reports under its own key and the most recent one is
// what shows; the notification opens on the first key and closes when the last
// one ends.
export class ActivityProgress {
    private connection: Connection;

    // Insertion-ordered, so the most recently reported activity is last. A key
    // is deleted before being re-set so re-reporting moves it to the end —
    // otherwise a long-running activity that merely started first would keep
    // the display no matter what happened since.
    private activities = new Map<string, string>();

    private reporter: WorkDoneProgressServerReporter | null = null;
    private opening: boolean = false;

    // What the user is currently being shown. An activity ending underneath
    // the one on top re-renders without changing anything, and re-sending the
    // same message would spend a notification saying nothing new.
    private shown: string | null = null;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    // Show `message` for `activity`, replacing whatever it was showing before.
    report(activity: Activity, message: string) {
        this.activities.delete(activity);
        this.activities.set(activity, message);

        this.render();
    }

    // Stop showing `activity`. Harmless if it was never reported.
    end(activity: Activity) {
        if (!this.activities.delete(activity)) {
            return;
        }

        this.render();
    }

    private current(): string | null {
        let message: string | null = null;

        for (const activity of this.activities.values()) {
            message = activity;
        }

        return message;
    }

    private render() {
        const message = this.current();

        if (message == null) {
            this.reporter?.done();
            this.reporter = null;
            this.shown = null;

            return;
        }

        if (this.reporter) {
            if (message != this.shown) {
                this.shown = message;

                this.reporter.report(message);
            }

            return;
        }

        this.open();
    }

    // Creating a reporter is a round trip to the client, and activities come
    // and go while it is in flight — so the message is read from the map when
    // the reporter arrives rather than captured at the call, and a reporter
    // whose activities have all ended in the meantime is opened and closed
    // rather than left half-begun.
    private open() {
        if (this.opening || !this.connection?.window?.createWorkDoneProgress) {
            return;
        }

        this.opening = true;

        Promise.resolve(this.connection.window.createWorkDoneProgress()).then(
            reporter => {
                this.opening = false;

                const message = this.current();

                reporter.begin("ghūl", undefined, message ?? "", false);

                if (message == null) {
                    reporter.done();

                    return;
                }

                this.reporter = reporter;
                this.shown = message;
            },
            e => {
                this.opening = false;

                log(`could not create a progress reporter: ${e}`);
            }
        );
    }
}
