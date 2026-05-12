import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';

import { ProblemStore } from '../src/problem-store';

function diag(message: string): Diagnostic {
    return {
        severity: DiagnosticSeverity.Error,
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
        },
        message,
        source: 'test',
    };
}

function collect(store: ProblemStore) {
    return Array.from(store);
}

describe('ProblemStore', () => {
    let store: ProblemStore;

    beforeEach(() => {
        store = new ProblemStore();
    });

    it('starts empty', () => {
        expect(collect(store)).toEqual([]);
    });

    it('stores parse problems per uri', () => {
        store.add('parse', 'file:///a.ghul', diag('p1'));
        store.add('parse', 'file:///a.ghul', diag('p2'));

        const result = collect(store);
        expect(result).toHaveLength(1);
        expect(result[0].uri).toBe('file:///a.ghul');
        expect(result[0].diagnostics.map(d => d.message)).toEqual(['p1', 'p2']);
    });

    it('stores analysis problems per uri', () => {
        store.add('analysis', 'file:///a.ghul', diag('a1'));

        const result = collect(store);
        expect(result[0].diagnostics.map(d => d.message)).toEqual(['a1']);
    });

    it('returns parse problems before analysis problems for the same uri', () => {
        store.add('analysis', 'file:///a.ghul', diag('a1'));
        store.add('parse', 'file:///a.ghul', diag('p1'));

        const result = collect(store);
        expect(result[0].diagnostics.map(d => d.message)).toEqual(['p1', 'a1']);
    });

    it('separates problems for different uris', () => {
        store.add('parse', 'file:///a.ghul', diag('a'));
        store.add('parse', 'file:///b.ghul', diag('b'));

        const uris = collect(store).map(d => d.uri).sort();
        expect(uris).toEqual(['file:///a.ghul', 'file:///b.ghul']);
    });

    it('ignores unknown kinds', () => {
        store.add('unknown', 'file:///a.ghul', diag('ignored'));

        expect(collect(store)).toEqual([]);
    });

    it('clear() removes everything', () => {
        store.add('parse', 'file:///a.ghul', diag('p'));
        store.add('analysis', 'file:///b.ghul', diag('a'));

        store.clear();

        expect(collect(store)).toEqual([]);
    });

    it('clear_parse_problems for a uri also clears its analysis problems (current behaviour)', () => {
        store.add('parse', 'file:///a.ghul', diag('p1'));
        store.add('analysis', 'file:///a.ghul', diag('a1'));

        store.clear_parse_problems('file:///a.ghul');

        const result = collect(store);
        expect(result).toHaveLength(1);
        expect(result[0].diagnostics).toEqual([]);
    });

    it('clear_analysis_problems leaves parse problems intact', () => {
        store.add('parse', 'file:///a.ghul', diag('p1'));
        store.add('analysis', 'file:///a.ghul', diag('a1'));

        store.clear_analysis_problems('file:///a.ghul');

        const result = collect(store);
        expect(result[0].diagnostics.map(d => d.message)).toEqual(['p1']);
    });

    it('clear_all_analysis_problems clears analysis problems across all uris', () => {
        store.add('parse', 'file:///a.ghul', diag('pa'));
        store.add('analysis', 'file:///a.ghul', diag('aa'));
        store.add('parse', 'file:///b.ghul', diag('pb'));
        store.add('analysis', 'file:///b.ghul', diag('ab'));

        store.clear_all_analysis_problems();

        const result = collect(store).sort((x, y) => x.uri.localeCompare(y.uri));
        expect(result[0].diagnostics.map(d => d.message)).toEqual(['pa']);
        expect(result[1].diagnostics.map(d => d.message)).toEqual(['pb']);
    });

    it('get_problem_list_for creates a list on first access', () => {
        const list = store.get_problem_list_for('file:///c.ghul');
        expect(list.parse).toEqual([]);
        expect(list.analysis).toEqual([]);
        // second access returns the same instance:
        expect(store.get_problem_list_for('file:///c.ghul')).toBe(list);
    });
});
