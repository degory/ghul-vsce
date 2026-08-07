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
    // A request outstanding for long enough to be worth mentioning, when
    // nothing more specific is being shown. The analyser recompiles on demand
    // to answer a query and does not say so in advance, so an ordinary hover
    // can turn into a wait with no other warning of it.
    Request = 'request',
}

// How long an activity has to run before it is worth interrupting the user
// with. Below this, showing and immediately hiding a spinner is a flicker that
// reads as instability rather than as information.
export const SLOW_ACTIVITY_DELAY_MS = 500;

// How long to wait for the client to answer a request for a progress token.
//
// Only one such request is ever in flight, so one that is never answered would
// otherwise be the last one ever made, and every activity for the rest of the
// session would go unreported. Giving up lets the next activity ask again;
// nothing is lost but the one notification.
export const CREATE_TIMEOUT_MS = 10_000;

interface ReportedActivity {
    message: string;
    // A fallback activity is shown only when nothing more specific is. The
    // generic "a request is taking a while" is true during a full compile too,
    // but "checking project" says more, and whichever was reported last would
    // otherwise win on recency alone.
    fallback: boolean;
}

export interface ReportOptions {
    // Wait this long before showing the activity, and drop it silently if it
    // ends first.
    delay_ms?: number;
    fallback?: boolean;
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
    private activities = new Map<string, ReportedActivity>();

    // Activities reported with a delay that has not elapsed yet. Held apart
    // from `activities` so an activity that ends inside its own delay is never
    // shown at all.
    private waiting = new Map<string, { timer: NodeJS.Timeout, activity: ReportedActivity }>();

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
    report(activity: Activity, message: string, options: ReportOptions = {}) {
        const reported = { message, fallback: options.fallback ?? false };

        // Already waiting out its delay: update what it will say when the
        // delay expires, but do not restart the clock — the wait the user is
        // enduring started when the activity did.
        const waiting = this.waiting.get(activity);

        if (waiting) {
            waiting.activity = reported;

            return;
        }

        if (options.delay_ms && !this.activities.has(activity)) {
            const timer = setTimeout(() => {
                const pending = this.waiting.get(activity);

                this.waiting.delete(activity);

                if (pending) {
                    this.show(activity, pending.activity);
                }
            }, options.delay_ms);

            timer.unref?.();

            this.waiting.set(activity, { timer, activity: reported });

            return;
        }

        this.show(activity, reported);
    }

    // Stop showing `activity`. Harmless if it was never reported, and if it
    // was reported with a delay that has not elapsed, it is never shown.
    end(activity: Activity) {
        const waiting = this.waiting.get(activity);

        if (waiting) {
            clearTimeout(waiting.timer);
            this.waiting.delete(activity);
        }

        if (!this.activities.delete(activity)) {
            return;
        }

        this.render();
    }

    private show(activity: Activity, reported: ReportedActivity) {
        this.activities.delete(activity);
        this.activities.set(activity, reported);

        this.render();
    }

    private current(): string | null {
        let message: string | null = null;
        let fallback: string | null = null;

        for (const activity of this.activities.values()) {
            if (activity.fallback) {
                fallback = activity.message;
            } else {
                message = activity.message;
            }
        }

        return message ?? fallback;
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

        const give_up = setTimeout(() => {
            this.opening = false;

            log("the client has not granted a progress token; will ask again for the next activity");
        }, CREATE_TIMEOUT_MS);

        give_up.unref?.();

        Promise.resolve(this.connection.window.createWorkDoneProgress()).then(
            reporter => {
                clearTimeout(give_up);

                this.opening = false;

                const message = this.current();

                // Nothing left to announce, or a later request was granted
                // first because this one was given up on. A token has to be
                // begun before it can be ended, so close it with no message —
                // the client renders nothing for a blank one.
                if (message == null || this.reporter) {
                    reporter.begin("ghūl", undefined, "", false);
                    reporter.done();

                    return;
                }

                reporter.begin("ghūl", undefined, message, false);

                this.reporter = reporter;
                this.shown = message;
            },
            e => {
                clearTimeout(give_up);

                this.opening = false;

                log(`could not create a progress reporter: ${e}`);
            }
        );
    }
}
