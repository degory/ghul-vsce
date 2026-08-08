import {
    incrementalRate,
    summariseIncrementalStats,
    StatEntry
} from '../src/incremental-stats';

function entries(counts: Record<string, number>): StatEntry[] {
    return Object.entries(counts).map(([name, count]) => ({
        name,
        count,
        moving_average_ms: 0
    }));
}

describe('summariseIncrementalStats', () => {
    it('separates the three edit paths', () => {
        const stats = summariseIncrementalStats(entries({
            'edit-path-body-rewalk': 7,
            'edit-path-interface-incremental': 2,
            'edit-path-full-rebuild': 1
        }));

        expect(stats.body_rewalk).toBe(7);
        expect(stats.interface_incremental).toBe(2);
        expect(stats.full_rebuild).toBe(1);
        expect(stats.total).toBe(10);
    });

    it('counts a path the analyser never took as zero', () => {
        // The analyser declares its whole counter vocabulary at startup, so a
        // path that has not been taken arrives at zero rather than missing.
        // Both spellings have to mean the same thing here, because a client
        // talking to an older analyser sees the absent form.
        const declared = summariseIncrementalStats(entries({
            'edit-path-body-rewalk': 0,
            'edit-path-interface-incremental': 0,
            'edit-path-full-rebuild': 4
        }));

        const absent = summariseIncrementalStats(entries({
            'edit-path-full-rebuild': 4
        }));

        expect(declared).toEqual(absent);
    });

    it('names the reason accounting for most rebuilds', () => {
        const stats = summariseIncrementalStats(entries({
            'edit-path-full-rebuild': 10,
            'edit-declined-not-eligible': 3,
            'edit-declined-class-header-mismatch': 7
        }));

        expect(stats.top_decline_reason).toBe('class-header-mismatch');
        expect(stats.top_decline_count).toBe(7);
    });

    it('reports no reason when nothing has been rebuilt', () => {
        const stats = summariseIncrementalStats(entries({
            'edit-path-body-rewalk': 5,
            'edit-declined-not-eligible': 0
        }));

        expect(stats.top_decline_reason).toBeNull();
        expect(stats.top_decline_count).toBe(0);
    });

    it('ignores counters that are not edit paths or decline reasons', () => {
        // The same snapshot carries the file-pass / file-rewalk / subtree-pass
        // families and every ordinary timer; none of them are edits and none
        // may reach the rate.
        const stats = summariseIncrementalStats(entries({
            'edit-path-body-rewalk': 1,
            'file-pass:compile-expressions': 400,
            'file-rewalk:compile-expressions': 12,
            'subtree-pass:declare-symbols': 3,
            'edit-single': 99
        }));

        expect(stats.total).toBe(1);
        expect(stats.top_decline_reason).toBeNull();
    });

    it('survives an empty or absent snapshot', () => {
        expect(summariseIncrementalStats([]).total).toBe(0);
        expect(summariseIncrementalStats(null as unknown as StatEntry[]).total).toBe(0);
    });
});

describe('incrementalRate', () => {
    it('counts both incremental paths as served incrementally', () => {
        const stats = summariseIncrementalStats(entries({
            'edit-path-body-rewalk': 6,
            'edit-path-interface-incremental': 2,
            'edit-path-full-rebuild': 2
        }));

        expect(incrementalRate(stats)).toBeCloseTo(0.8);
    });

    it('distinguishes no edits yet from every edit rebuilding', () => {
        // The distinction this whole report exists to draw: an analyser that
        // has done nothing must not read as one that has rebuilt everything.
        const nothing = summariseIncrementalStats([]);
        const all_rebuilt = summariseIncrementalStats(entries({
            'edit-path-full-rebuild': 5
        }));

        expect(incrementalRate(nothing)).toBeNull();
        expect(incrementalRate(all_rebuilt)).toBe(0);
    });
});
