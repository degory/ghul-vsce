import { Connection } from 'vscode-languageserver';

import { Activity, ActivityProgress, CREATE_TIMEOUT_MS, SLOW_ACTIVITY_DELAY_MS } from '../src/activity-progress';

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

        progress.report(Activity.Compile, 'full analysis');

        expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'restoring .NET tools', false);
        expect(reporter.report).toHaveBeenLastCalledWith('full analysis');
    });

    it('falls back to what is still running when an activity ends', async () => {
        // Overlap is normal — a full compile can start while referenced
        // projects are still building — and the user should be told what is
        // still happening rather than have the notification vanish.
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.References, 'building referenced projects');
        await settle();

        progress.report(Activity.Compile, 'full analysis');
        progress.end(Activity.Compile);

        expect(reporter.report).toHaveBeenLastCalledWith('building referenced projects');
        expect(reporter.done).not.toHaveBeenCalled();
    });

    it('re-reporting an activity brings it back to the front', async () => {
        // Map keys do not move on re-set, so without an explicit delete the
        // longest-running activity would hold the display forever.
        const reporter = makeReporter();
        const progress = new ActivityProgress(makeConnection(reporter));

        progress.report(Activity.Compiler, 'starting analyser');
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

        progress.report(Activity.Compiler, 'starting analyser');
        progress.end(Activity.Setup);

        expect(reporter.report.mock.calls.map(([message]) => message))
            .toEqual(['starting analyser']);
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

        progress.report(Activity.Compile, 'full analysis');
        await settle();

        expect(reporter.begin).toHaveBeenCalledTimes(2);
        expect(reporter.begin).toHaveBeenLastCalledWith('ghūl', undefined, 'full analysis', false);
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
        progress.report(Activity.Compile, 'full analysis');
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

            progress.report(Activity.Compile, 'full analysis');
            await Promise.resolve();
            progress.report(Activity.Request, 'analysing', { fallback: true });

            expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'full analysis', false);
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
            progress.report(Activity.Compile, 'full analysis');
            progress.end(Activity.Compile);

            expect(reporter.report).toHaveBeenLastCalledWith('analysing');
            expect(reporter.done).not.toHaveBeenCalled();
        });
    });

    describe('when the client does not grant a token', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        // A client whose grants are held, so a test can answer requests out of
        // order or not at all.
        function makeDeferredConnection() {
            const grants: ((reporter: any) => void)[] = [];

            const connection = {
                window: {
                    createWorkDoneProgress: jest.fn(
                        () => new Promise(resolve => { grants.push(resolve); })
                    ),
                },
            } as unknown as Connection;

            return { connection, grants };
        }

        it('asks again for a later activity after a request goes unanswered', async () => {
            // Only one request for a token is ever in flight, so one that is
            // never answered would otherwise be the last one ever made — every
            // activity for the rest of the session silently unreported, with
            // the start-up sequence that already completed still looking fine.
            const { connection, grants } = makeDeferredConnection();
            const progress = new ActivityProgress(connection);

            progress.report(Activity.Compile, 'full analysis');

            expect(grants).toHaveLength(1);

            jest.advanceTimersByTime(CREATE_TIMEOUT_MS);
            progress.end(Activity.Compile);

            progress.report(Activity.Heap, 'garbage collecting');

            expect(grants).toHaveLength(2);

            const reporter = makeReporter();
            grants[1](reporter);
            await Promise.resolve();

            expect(reporter.begin).toHaveBeenCalledWith('ghūl', undefined, 'garbage collecting', false);
        });

        it('closes a token granted so late that another has taken over', async () => {
            const abandoned = makeReporter();
            const current = makeReporter();

            const { connection, grants } = makeDeferredConnection();
            const progress = new ActivityProgress(connection);

            progress.report(Activity.Compile, 'full analysis');
            jest.advanceTimersByTime(CREATE_TIMEOUT_MS);

            progress.report(Activity.Heap, 'garbage collecting');
            grants[1](current);
            await Promise.resolve();

            expect(current.begin).toHaveBeenCalledWith('ghūl', undefined, 'garbage collecting', false);

            // The abandoned request is answered eventually. Its token must be
            // closed rather than left half-open, and must not displace the one
            // now in use.
            grants[0](abandoned);
            await Promise.resolve();

            expect(abandoned.begin).toHaveBeenCalledWith('ghūl', undefined, '', false);
            expect(abandoned.done).toHaveBeenCalled();
            expect(current.done).not.toHaveBeenCalled();
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
