import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { CompilerQuickFixProvider } from '../src/compiler-quick-fix-provider';
import { DiagnosticDto, QuickFixDto } from '../src/response-handler';

function range(line: number, start: number, end: number): Range {
    return {
        start: { line, character: start },
        end: { line, character: end },
    };
}

// Wire coordinates are 1-based; the LSP ones above are 0-based.
function diag(fixes?: QuickFixDto[]): DiagnosticDto {
    return {
        path: '/x.ghul',
        start_line: 1,
        start_column: 9,
        end_line: 1,
        end_column: 11,
        severity: 2,
        message: 'a warning',
        code: 'redundant-unwrap',
        fixes: fixes ?? null,
    };
}

function removalFix(): QuickFixDto {
    return {
        title: "Remove redundant '!'",
        is_preferred: true,
        edits: [{
            start_line: 1, start_column: 10, end_line: 1, end_column: 11,
            replaces: '!', new_text: ''
        }],
    };
}

function suppressFix(): QuickFixDto {
    return {
        title: 'Suppress here: @suppress("redundant-unwrap")',
        is_preferred: false,
        edits: [{
            start_line: 1, start_column: 1, end_line: 1, end_column: 1,
            replaces: null, new_text: '@suppress("redundant-unwrap")\n'
        }],
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

    it('returns no actions for diagnostics without fixes', () => {
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

    it('attaches the resolved diagnostic to each action', () => {
        const document = doc('let x = b!;\n');

        const actions = provider.provide(document, URI, [diag([removalFix()])]);

        expect(actions[0].diagnostics).toEqual([{
            severity: DiagnosticSeverity.Warning,
            range: range(0, 8, 10),
            message: 'a warning',
            source: 'ghūl',
            code: 'redundant-unwrap',
        }]);
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
        d.fixes = [{ nonsense: true }, 42, null] as unknown as QuickFixDto[];

        expect(provider.provide(document, URI, [d])).toEqual([]);
    });
});
