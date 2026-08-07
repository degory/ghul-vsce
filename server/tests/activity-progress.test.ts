import { Connection } from 'vscode-languageserver';

import { Activity, ActivityProgress, SLOW_ACTIVITY_DELAY_MS } from '../src/activity-progress';

// A reporter that records what the user would see, in order.
function makeReporter() {
    return {
        begin: jest.fn(),
        report: jest.fn(),
        done: jest.fn(),
    };
}

function makeConnection(reporter: any, resolve_later?: { resolve: (r: any) => void }): Connection {
    return {
        window: {
            createWorkDoneProgress: jest.fn(() =>
                resolve_later
                    ? new Promise(r => { resolve_later.resolve = () => r(reporter); })
                    : Promise.resolve(reporter)
            ),
        },
    } as unknown as Connection;
}

// Lets the pending createWorkDoneProgress continuation run.
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('ActivityProgress', () => {
    it('shows the most recently reported activity', async () => {
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.Setup, 'restoring .NET tools');
        await settle();

        progress.report(Activity.Compile, 'checking project');

        expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'restoring .NET tools', false);
        expect(reporter.report).toHaveBeenLastCalledWith('checking project');
    });

    it('falls back to what is still running when an activity ends', async () => {
        // Overlap is normal — a full compile can start while referenced
        // projects are still building — and the user should be told what is
        // still happening rather than have the notification vanish.
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.References, 'building referenced projects');
        await settle();

        progress.report(Activity.Compile, 'checking project');
        progress.end(Activity.Compile);

        expect(reporter.report).toHaveBeenLastCalledWith('building referenced projects');
        expect(reporter.done).not.toHaveBeenCalled();
    });

    it('re-reporting an activity brings it back to the front', async () => {
        // Map keys do not move on re-set, so without an explicit delete the
        // longest-running activity would hold the display forever.
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.Compiler, 'starting compiler');
        await settle();

        progress.report(Activity.Heap, 'garbage collecting');
        progress.report(Activity.Compiler, 'analysing project');

        expect(reporter.report).toHaveBeenLastCalledWith('analysing project');
    });

    it('does not re-send a message that is already showing', async () => {
        // An activity ending underneath the one on top changes nothing the
        // user can see.
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.Setup, 'restoring .NET tools');
        await settle();

        progress.report(Activity.Compiler, 'starting compiler');
        progress.end(Activity.Setup);

        expect(reporter.report.mock.calls.map(([message]) => message))
            .toEqual(['starting compiler']);
    });

    it('closes the notification when the last activity ends', async () => {
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.Heap, 'garbage collecting');
        await settle();

        progress.end(Activity.Heap);

        expect(reporter.done).toHaveBeenCalled();
    });

    it('reopens after everything ended', async () => {
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.Heap, 'garbage collecting');
        await settle();
        progress.end(Activity.Heap);

        progress.report(Activity.Compile, 'checking project');
        await settle();

        expect(reporter.begin).toHaveBeenCalledTimes(2);
        expect(reporter.begin).toHaveBeenLastCalledWith('ghūl', undefined, 'checking project', false);
    });

    it('does not leave a half-open notification when the activity ends mid-creation', async () => {
        // Creating a reporter is a round trip; a short activity can be over
        // before it comes back.
        const reporter = makeReporter();
        const later = { resolve: (_: any) => { } };
        const progress = new ActivityProgress(makeConnection(reporter, later));

        progress.report(Activity.Heap, 'garbage collecting');
        progress.end(Activity.Heap);

        later.resolve(reporter);
        await settle();

        expect(reporter.begin).toHaveBeenCalled();
        expect(reporter.done).toHaveBeenCalled();
    });

    it('opens only one notification however many activities start at once', async () => {
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.Setup, 'restoring .NET tools');
        progress.report(Activity.Compile, 'checking project');
        progress.report(Activity.Heap, 'garbage collecting');
        await settle();

        expect(reporter.begin).toHaveBeenCalledTimes(1);
    });

    describe('delayed activities', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('says nothing about work that finishes quickly', async () => {
            // Most requests answer in a few milliseconds. A spinner shown and
            // hidden inside that reads as instability, not information.
            const reporter = makeReporter();
            const progress = new ActivityProgress(makeConnection(reporter));

            progress.report(Activity.Request, 'analysing', { delay_ms: SLOW_ACTIVITY_DELAY_MS });
            jest.advanceTimersByTime(SLOW_ACTIVITY_DELAY_MS - 1);
            progress.end(Activity.Request);

            jest.advanceTimersByTime(SLOW_ACTIVITY_DELAY_MS);
            await Promise.resolve();

            expect(reporter.begin).not.toHaveBeenCalled();
        });

        it('speaks up once work outlasts the delay', async () => {
            const reporter = makeReporter();
            const progress = new ActivityProgress(makeConnection(reporter));

            progress.report(Activity.Request, 'analysing', { delay_ms: SLOW_ACTIVITY_DELAY_MS });
            jest.advanceTimersByTime(SLOW_ACTIVITY_DELAY_MS);
            await Promise.resolve();

            expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'analysing', false);
        });

        it('does not restart the clock when a waiting activity is re-reported', async () => {
            // The wait the user is enduring started when the activity did, so
            // a repeat report must not push the spinner further away.
            const reporter = makeReporter();
            const progress = new ActivityProgress(makeConnection(reporter));

            progress.report(Activity.Request, 'analysing', { delay_ms: SLOW_ACTIVITY_DELAY_MS });
            jest.advanceTimersByTime(SLOW_ACTIVITY_DELAY_MS - 100);
            progress.report(Activity.Request, 'still analysing', { delay_ms: SLOW_ACTIVITY_DELAY_MS });
            jest.advanceTimersByTime(100);
            await Promise.resolve();

            expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'still analysing', false);
        });
    });

    describe('fallback activities', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('yields to whatever describes the work better', async () => {
            // Every full compile is also an outstanding request, and the
            // generic description would win on recency alone.
            const reporter = makeReporter();
            const progress = new ActivityProgress(makeConnection(reporter));

            progress.report(Activity.Compile, 'checking project');
            await Promise.resolve();
            progress.report(Activity.Request, 'analysing', { fallback: true });

            expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'checking project', false);
            expect(reporter.report).not.toHaveBeenCalledWith('analysing');
        });

        it('shows when nothing more specific is running', async () => {
            // A hover that turns into a recompile has nothing else to say.
            const reporter = makeReporter();
            const progress = new ActivityProgress(makeConnection(reporter));

            progress.report(Activity.Request, 'analysing', { fallback: true });
            await Promise.resolve();

            expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'analysing', false);
        });

        it('takes over when the more specific activity ends first', async () => {
            const reporter = makeReporter();
            const progress = new ActivityProgress(makeConnection(reporter));

            progress.report(Activity.Request, 'analysing', { fallback: true });
            await Promise.resolve();
            progress.report(Activity.Compile, 'checking project');
            progress.end(Activity.Compile);

            expect(reporter.report).toHaveBeenLastCalledWith('analysing');
            expect(reporter.done).not.toHaveBeenCalled();
        });
    });

    it('is inert on a client that cannot report progress', () => {
        const progress = new ActivityProgress({ window: {} } as unknown as Connection);

        expect(() => {
            progress.report(Activity.Setup, 'restoring .NET tools');
            progress.end(Activity.Setup);
        }).not.toThrow();
    });
});
