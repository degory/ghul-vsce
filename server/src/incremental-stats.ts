// Reads the analyser's work counters and says whether incremental analysis is
// actually happening.
//
// The analyser handles every EDIT by one of three paths and counts which: two
// incremental ones that reuse the state it already has, and a whole-project
// rebuild. When it rebuilds it also counts *why*, latching exactly one named
// reason per rebuilt edit — so the reasons sum to the rebuild tally and name
// the guard responsible rather than merely reporting that some guard fired.
//
// Nothing else reports this. The EDIT response carries a duration but not
// which path produced it, so a rebuild and a body re-walk are indistinguishable
// from the outside except by being slow — and "slow" is exactly the symptom
// that prompts the question. Reading the counters answers it directly.
//
// Names mirror Logging.WORK_COUNTERS in the compiler (src/logging/work_counters.ghul).
// The analyser declares its whole vocabulary at startup, so a path that has not
// been taken reports zero rather than being absent — which is what lets a rate
// be computed honestly instead of inferred from missing names.

// One analyser timer or counter, as it arrives on the wire.
export interface StatEntry {
    name: string;
    count: number;
    moving_average_ms: number;
}

export const EDIT_PATH_BODY_REWALK = 'edit-path-body-rewalk';
export const EDIT_PATH_INTERFACE_INCREMENTAL = 'edit-path-interface-incremental';
export const EDIT_PATH_FULL_REBUILD = 'edit-path-full-rebuild';

export const DECLINED_PREFIX = 'edit-declined-';

// The reason the analyser reports for an edit that was never a candidate at
// all, as against one that was and failed a specific guard. Worth naming here
// because it is the signature of incremental analysis being switched off: with
// the feature off every edit declines this way, so this reason accounting for
// effectively all rebuilds means the setting never reached the analyser, where
// any other dominant reason means it did and the edits are being refused on
// their merits.
export const NOT_ELIGIBLE = 'not-eligible';

export interface IncrementalStats {
    // Edits the analyser has handled, by path.
    body_rewalk: number;
    interface_incremental: number;
    full_rebuild: number;
    // Sum of the three. Zero before the first edit, in which case there is no
    // rate to report yet rather than a rate of zero.
    total: number;
    // The most common reason for a rebuild, and how many of the rebuilds it
    // accounts for. Null when nothing has been rebuilt.
    top_decline_reason: string | null;
    top_decline_count: number;
}

// Pull the edit-path tallies and decline reasons out of a STATS snapshot.
// Counters are cumulative for the analyser's lifetime, so this is a running
// total since it started, not a window — a restart is what resets it.
export function summariseIncrementalStats(entries: StatEntry[]): IncrementalStats {
    const counts = new Map<string, number>();

    for (const entry of entries ?? []) {
        counts.set(entry.name, entry.count);
    }

    const body_rewalk = counts.get(EDIT_PATH_BODY_REWALK) ?? 0;
    const interface_incremental = counts.get(EDIT_PATH_INTERFACE_INCREMENTAL) ?? 0;
    const full_rebuild = counts.get(EDIT_PATH_FULL_REBUILD) ?? 0;

    let top_decline_reason: string | null = null;
    let top_decline_count = 0;

    for (const [name, count] of counts) {
        if (!name.startsWith(DECLINED_PREFIX) || count <= top_decline_count) {
            continue;
        }

        top_decline_reason = name.slice(DECLINED_PREFIX.length);
        top_decline_count = count;
    }

    return {
        body_rewalk,
        interface_incremental,
        full_rebuild,
        total: body_rewalk + interface_incremental + full_rebuild,
        top_decline_reason,
        top_decline_count
    };
}

// Proportion of edits served without rebuilding the project, 0 to 1, or null
// when no edit has been handled yet. Null rather than zero because "nothing has
// happened" and "everything rebuilt" are the two answers this whole report
// exists to tell apart.
export function incrementalRate(stats: IncrementalStats): number | null {
    if (stats.total === 0) {
        return null;
    }

    return (stats.body_rewalk + stats.interface_incremental) / stats.total;
}
