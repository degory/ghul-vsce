import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { RemoveRedundantOperatorCodeActionProvider } from '../src/remove-redundant-operator-code-action-provider';

function diag(range: Range, code?: string): Diagnostic {
    const d: Diagnostic = {
        severity: DiagnosticSeverity.Warning,
        range,
        message: 'a warning',
        source: 'ghūl',
    };

    if (code !== undefined) {
        d.code = code;
    }

    return d;
}

function range(line: number, start: number, end: number): Range {
    return {
        start: { line, character: start },
        end: { line, character: end },
    };
}

function doc(text: string): TextDocument {
    return TextDocument.create('file:///x.ghul', 'ghul', 1, text);
}

const URI = 'file:///x.ghul';

describe('RemoveRedundantOperatorCodeActionProvider', () => {
    let provider: RemoveRedundantOperatorCodeActionProvider;

    beforeEach(() => {
        provider = new RemoveRedundantOperatorCodeActionProvider();
    });

    it('returns no actions for diagnostics without a code', () => {
        const document = doc('let x = b!;\n');

        const actions = provider.provide(document, URI, [diag(range(0, 8, 10))]);

        expect(actions).toEqual([]);
    });

    it('returns no actions for codes it does not handle', () => {
        const document = doc('let x = b!;\n');

        const actions = provider.provide(document, URI, [diag(range(0, 8, 10), 'non-exception-throw')]);

        expect(actions).toEqual([]);
    });

    it("removes the trailing '!' for redundant-unwrap", () => {
        //             0123456789
        const document = doc('let x = b!.label;\n');

        const actions = provider.provide(document, URI, [diag(range(0, 8, 10), 'redundant-unwrap')]);

        expect(actions).toHaveLength(1);
        expect(actions[0].title).toBe("Remove redundant '!'");
        expect(actions[0].kind).toBe('quickfix');
        expect(actions[0].isPreferred).toBe(true);

        const edits = actions[0].edit!.changes![URI];
        expect(edits).toHaveLength(1);
        expect(edits[0].range).toEqual(range(0, 9, 10));
        expect(edits[0].newText).toBe('');
    });

    it("removes the trailing '?' for redundant-presence-test", () => {
        //             0         1
        //             0123456789012345678
        const document = doc('write_line("{name?}");\n');

        const actions = provider.provide(document, URI, [diag(range(0, 13, 18), 'redundant-presence-test')]);

        expect(actions).toHaveLength(1);
        expect(actions[0].title).toBe("Remove redundant '?'");

        const edits = actions[0].edit!.changes![URI];
        expect(edits[0].range).toEqual(range(0, 17, 18));
        expect(edits[0].newText).toBe('');
    });

    it('offers nothing when the range does not end with the expected operator', () => {
        const document = doc('let x = b;\n');

        const actions = provider.provide(document, URI, [diag(range(0, 8, 9), 'redundant-unwrap')]);

        expect(actions).toEqual([]);
    });

    it("deletes the '?' of the one '?.' for redundant-coalesce", () => {
        //             0         1
        //             012345678901234567
        const document = doc('let x = b?.label;\n');

        const actions = provider.provide(document, URI, [diag(range(0, 8, 16), 'redundant-coalesce')]);

        expect(actions).toHaveLength(1);
        expect(actions[0].title).toBe("Replace '?.' with '.'");

        const edits = actions[0].edit!.changes![URI];
        expect(edits[0].range).toEqual(range(0, 9, 10));
        expect(edits[0].newText).toBe('');
    });

    it("offers nothing for a redundant-coalesce range holding more than one '?.'", () => {
        const document = doc('let x = a?.b?.c;\n');

        const actions = provider.provide(document, URI, [diag(range(0, 8, 15), 'redundant-coalesce')]);

        expect(actions).toEqual([]);
    });

    it('handles a multi-line operand range', () => {
        const document = doc('let x = get(\n    a\n)!;\n');

        const actions = provider.provide(document, URI, [
            diag({ start: { line: 0, character: 8 }, end: { line: 2, character: 2 } }, 'redundant-unwrap'),
        ]);

        expect(actions).toHaveLength(1);

        const edits = actions[0].edit!.changes![URI];
        expect(edits[0].range).toEqual(range(2, 1, 2));
    });

    it('deduplicates identical diagnostics', () => {
        const document = doc('let x = b!;\n');
        const d = diag(range(0, 8, 10), 'redundant-unwrap');

        const actions = provider.provide(document, URI, [d, d]);

        expect(actions).toHaveLength(1);
    });

    it('attaches the source diagnostic to the emitted action', () => {
        const document = doc('let x = b!;\n');
        const d = diag(range(0, 8, 10), 'redundant-unwrap');

        const actions = provider.provide(document, URI, [d]);

        expect(actions[0].diagnostics).toEqual([d]);
    });
});
