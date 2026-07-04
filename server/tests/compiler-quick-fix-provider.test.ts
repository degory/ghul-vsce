import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { CompilerQuickFixProvider, QuickFixData } from '../src/compiler-quick-fix-provider';

function range(line: number, start: number, end: number): Range {
    return {
        start: { line, character: start },
        end: { line, character: end },
    };
}

function diag(fixes?: QuickFixData[]): Diagnostic {
    const d: Diagnostic = {
        severity: DiagnosticSeverity.Warning,
        range: range(0, 8, 10),
        message: 'a warning',
        source: 'ghūl',
    };

    if (fixes !== undefined) {
        d.data = { fixes };
    }

    return d;
}

function removalFix(): QuickFixData {
    return {
        title: "Remove redundant '!'",
        isPreferred: true,
        edits: [{ range: range(0, 9, 10), replaces: '!', newText: '' }],
    };
}

function suppressFix(): QuickFixData {
    return {
        title: 'Suppress here: @suppress("redundant-unwrap")',
        isPreferred: false,
        edits: [{ range: range(0, 0, 0), replaces: null, newText: '@suppress("redundant-unwrap")\n' }],
    };
}

function doc(text: string): TextDocument {
    return TextDocument.create('file:///x.ghul', 'ghul', 1, text);
}

const URI = 'file:///x.ghul';

describe('CompilerQuickFixProvider', () => {
    let provider: CompilerQuickFixProvider;

    beforeEach(() => {
        provider = new CompilerQuickFixProvider();
    });

    it('returns no actions for diagnostics without fix data', () => {
        const document = doc('let x = b!;\n');

        expect(provider.provide(document, URI, [diag()])).toEqual([]);
    });

    it('turns each fix into a quickfix action, preserving wire order', () => {
        const document = doc('let x = b!;\n');

        const actions = provider.provide(document, URI, [diag([removalFix(), suppressFix()])]);

        expect(actions.map(a => a.title)).toEqual([
            "Remove redundant '!'",
            'Suppress here: @suppress("redundant-unwrap")',
        ]);
        expect(actions[0].kind).toBe('quickfix');
        expect(actions[0].isPreferred).toBe(true);
        expect(actions[1].isPreferred).toBeUndefined();

        const edits = actions[0].edit!.changes![URI];
        expect(edits).toEqual([{ range: range(0, 9, 10), newText: '' }]);
    });

    it('attaches the source diagnostic to each action', () => {
        const document = doc('let x = b!;\n');
        const d = diag([removalFix()]);

        const actions = provider.provide(document, URI, [d]);

        expect(actions[0].diagnostics).toEqual([d]);
    });

    it('withholds a fix whose expected text no longer matches the buffer', () => {
        // The fix expects '!' at 0:9 but the buffer has drifted.
        const document = doc('let x = bb;\n');

        expect(provider.provide(document, URI, [diag([removalFix()])])).toEqual([]);
    });

    it('applies insertion edits without a text check', () => {
        const document = doc('anything at all\n');

        const actions = provider.provide(document, URI, [diag([suppressFix()])]);

        expect(actions).toHaveLength(1);
        expect(actions[0].edit!.changes![URI][0].newText).toBe('@suppress("redundant-unwrap")\n');
    });

    it('deduplicates identical fixes arriving on co-located diagnostics', () => {
        const document = doc('let x = b!;\n');

        const actions = provider.provide(document, URI, [
            diag([suppressFix()]),
            diag([suppressFix()]),
        ]);

        expect(actions).toHaveLength(1);
    });

    it('ignores malformed fix payloads', () => {
        const document = doc('let x = b!;\n');

        const d = diag();
        d.data = { fixes: [{ nonsense: true }, 42, null] };

        expect(provider.provide(document, URI, [d])).toEqual([]);
    });
});
