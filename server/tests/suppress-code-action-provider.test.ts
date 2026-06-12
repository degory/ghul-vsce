import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { SuppressCodeActionProvider } from '../src/suppress-code-action-provider';

function diag(line: number, column: number, code?: string): Diagnostic {
    const d: Diagnostic = {
        severity: DiagnosticSeverity.Warning,
        range: {
            start: { line, character: column },
            end: { line, character: column + 1 },
        },
        message: 'a warning',
        source: 'ghūl',
    };

    if (code !== undefined) {
        d.code = code;
    }

    return d;
}

function doc(text: string): TextDocument {
    return TextDocument.create('file:///x.ghul', 'ghul', 1, text);
}

const URI = 'file:///x.ghul';
const NL = '\n';

describe('SuppressCodeActionProvider', () => {
    let provider: SuppressCodeActionProvider;

    beforeEach(() => {
        provider = new SuppressCodeActionProvider();
    });

    it('returns no actions for diagnostics without a code', () => {
        const document = doc('namespace X is' + NL + '    throw 1;' + NL + 'si' + NL);

        const actions = provider.provide(document, URI, [diag(1, 4)]);

        expect(actions).toEqual([]);
    });

    it('returns no actions for diagnostics whose code is not a string', () => {
        const document = doc('namespace X is' + NL + '    throw 1;' + NL + 'si' + NL);

        const d = diag(1, 4);
        (d as Diagnostic).code = 42 as unknown as string;

        const actions = provider.provide(document, URI, [d]);

        expect(actions).toEqual([]);
    });

    it('offers a "Suppress here" action that inserts at the diagnostic line', () => {
        const document = doc('namespace X is' + NL + '    throw 1;' + NL + 'si' + NL);

        const actions = provider.provide(document, URI, [diag(1, 4, 'non-exception-throw')]);

        const here = actions.find(a => a.title.startsWith('Suppress here'));
        expect(here).toBeDefined();
        expect(here!.title).toBe('Suppress here: @suppress("non-exception-throw")');
        expect(here!.kind).toBe('quickfix');

        const edits = here!.edit!.changes![URI];
        expect(edits).toHaveLength(1);
        expect(edits[0].range.start).toEqual({ line: 1, character: 0 });
        expect(edits[0].range.end).toEqual({ line: 1, character: 0 });
        expect(edits[0].newText).toBe('    @suppress("non-exception-throw")\n');
    });

    it('walks up indentation to find enclosing-block and enclosing-method sites', () => {
        // namespace > class > method > if block > diagnostic
        // four indentation steps; the provider stops after method (scope 3).
        const document = doc(
            'namespace X is' + NL +
            '    class A is' + NL +
            '        m() is' + NL +
            '            if true then' + NL +
            '                throw 1;' + NL +
            '            fi' + NL +
            '        si' + NL +
            '    si' + NL +
            'si' + NL
        );

        const actions = provider.provide(document, URI, [diag(4, 16, 'non-exception-throw')]);

        const titles = actions.map(a => a.title);
        expect(titles).toEqual([
            'Suppress here: @suppress("non-exception-throw")',
            'Suppress for enclosing block: @suppress("non-exception-throw")',
            'Suppress for enclosing method: @suppress("non-exception-throw")',
        ]);

        const here = actions[0].edit!.changes![URI][0];
        expect(here.range.start).toEqual({ line: 4, character: 0 });
        expect(here.newText).toBe('                @suppress("non-exception-throw")\n');

        const block = actions[1].edit!.changes![URI][0];
        expect(block.range.start).toEqual({ line: 3, character: 0 });
        expect(block.newText).toBe('            @suppress("non-exception-throw")\n');

        const method = actions[2].edit!.changes![URI][0];
        expect(method.range.start).toEqual({ line: 2, character: 0 });
        expect(method.newText).toBe('        @suppress("non-exception-throw")\n');
    });

    it('skips blank and comment lines when measuring indent step-outs', () => {
        const document = doc(
            'namespace X is' + NL +
            '    class A is' + NL +
            '        m() is' + NL +
            '            // a leading comment' + NL +
            '' + NL +
            '            throw 1;' + NL +
            '        si' + NL +
            '    si' + NL +
            'si' + NL
        );

        const actions = provider.provide(document, URI, [diag(5, 12, 'non-exception-throw')]);

        // The "here" site sits at the throw's indent; the block step-out lands
        // on the method header (line 2), skipping the blank line 4 and the
        // comment line 3 even though they sit at the throw's own indent.
        expect(actions).toHaveLength(3);
        expect(actions[0].title).toBe('Suppress here: @suppress("non-exception-throw")');
        expect(actions[1].title).toBe('Suppress for enclosing block: @suppress("non-exception-throw")');
        expect(actions[2].title).toBe('Suppress for enclosing method: @suppress("non-exception-throw")');

        expect(actions[1].edit!.changes![URI][0].range.start.line).toBe(2);
        expect(actions[2].edit!.changes![URI][0].range.start.line).toBe(1);
    });

    it('caps scopes at the top of the file when there is no outer indent', () => {
        const document = doc('throw 1;' + NL);

        const actions = provider.provide(document, URI, [diag(0, 0, 'non-exception-throw')]);

        // Only "Suppress here"; no further indent steps available.
        expect(actions).toHaveLength(1);
        expect(actions[0].title).toBe('Suppress here: @suppress("non-exception-throw")');

        const edit = actions[0].edit!.changes![URI][0];
        expect(edit.range.start).toEqual({ line: 0, character: 0 });
        expect(edit.newText).toBe('@suppress("non-exception-throw")\n');
    });

    it('deduplicates per (code, line) so co-located diagnostics produce one action set', () => {
        const document = doc(
            'namespace X is' + NL +
            '    m() is' + NL +
            '        throw 1;' + NL +
            '    si' + NL +
            'si' + NL
        );

        const actions = provider.provide(document, URI, [
            diag(2, 8, 'non-exception-throw'),
            diag(2, 8, 'non-exception-throw'),
        ]);

        // Two identical diagnostics collapse to one action triple (here / block / method).
        expect(actions).toHaveLength(3);
        expect(new Set(actions.map(a => a.title)).size).toBe(3);
    });

    it('emits separate actions per distinct code on the same line', () => {
        const document = doc(
            'namespace X is' + NL +
            '    m() is' + NL +
            '        throw 1;' + NL +
            '    si' + NL +
            'si' + NL
        );

        const actions = provider.provide(document, URI, [
            diag(2, 8, 'non-exception-throw'),
            diag(2, 8, 'other-warning'),
        ]);

        const here = actions.filter(a => a.title.startsWith('Suppress here'));
        expect(here.map(a => a.title).sort()).toEqual([
            'Suppress here: @suppress("non-exception-throw")',
            'Suppress here: @suppress("other-warning")',
        ]);
    });

    it('attaches the source diagnostic to each emitted action', () => {
        const document = doc('throw 1;' + NL);
        const d = diag(0, 0, 'non-exception-throw');

        const actions = provider.provide(document, URI, [d]);

        expect(actions[0].diagnostics).toEqual([d]);
    });
});
