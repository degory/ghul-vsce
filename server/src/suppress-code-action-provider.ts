import {
    CodeAction,
    CodeActionKind,
    Diagnostic,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Per-scope candidate insertion site for a `@suppress("<code>")` pragma.
//   line   — 0-based line *before which* the pragma is inserted
//   indent — leading whitespace to mirror onto the pragma
//   label  — UI text for the quick-fix ("Suppress here", "...for enclosing block", ...)
interface InsertionSite {
    line: number;
    indent: string;
    label: string;
}

// The compiler attaches `@suppress("code")` to the next definition or
// statement, so the pragma must land at the start of the line that opens
// the scope to suppress.
export class SuppressCodeActionProvider {
    static readonly KIND: string = CodeActionKind.QuickFix;

    private static readonly SCOPE_LABELS: string[] = [
        'Suppress here',
        'Suppress for enclosing block',
        'Suppress for enclosing method',
    ];

    provide(document: TextDocument, uri: string, diagnostics: Diagnostic[]): CodeAction[] {
        const actions: CodeAction[] = [];
        const seen = new Set<string>();

        const text = document.getText();
        const lines = text.split('\n');

        for (const diagnostic of diagnostics) {
            const code = SuppressCodeActionProvider.codeOf(diagnostic);

            if (!code) {
                continue;
            }

            const sites = this.candidateSitesFor(lines, diagnostic.range.start.line);

            for (const site of sites) {
                const key = code + '@' + site.line;

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);

                actions.push(this.buildAction(uri, diagnostic, code, site));
            }
        }

        return actions;
    }

    // The wire DTO leaves `code` either undefined or string. LSP's Diagnostic
    // type permits string or integer; we offer suppression only for kebab-case
    // string slugs since that is what @suppress("...") consumes.
    private static codeOf(diagnostic: Diagnostic): string | null {
        const code = diagnostic.code;

        if (typeof code === 'string' && code.length > 0) {
            return code;
        }

        return null;
    }

    // Walk up from the diagnostic line collecting indentation step-outs.
    // The diagnostic line itself is the "statement" site; each line above
    // with strictly less indentation (skipping blank-or-comment lines) is
    // the next outer scope.
    private candidateSitesFor(lines: string[], diagnosticLine: number): InsertionSite[] {
        if (diagnosticLine < 0 || diagnosticLine >= lines.length) {
            return [];
        }

        const sites: InsertionSite[] = [];
        const startIndent = SuppressCodeActionProvider.indentOf(lines[diagnosticLine]);

        sites.push({
            line: diagnosticLine,
            indent: startIndent,
            label: SuppressCodeActionProvider.SCOPE_LABELS[0],
        });

        let currentIndent = startIndent;
        let scopeIndex = 1;

        for (let line = diagnosticLine - 1; line >= 0 && scopeIndex < SuppressCodeActionProvider.SCOPE_LABELS.length; line--) {
            const text = lines[line];

            if (SuppressCodeActionProvider.isBlankOrComment(text)) {
                continue;
            }

            const indent = SuppressCodeActionProvider.indentOf(text);

            if (indent.length < currentIndent.length) {
                sites.push({
                    line,
                    indent,
                    label: SuppressCodeActionProvider.SCOPE_LABELS[scopeIndex],
                });

                currentIndent = indent;
                scopeIndex++;
            }
        }

        return sites;
    }

    private buildAction(uri: string, diagnostic: Diagnostic, code: string, site: InsertionSite): CodeAction {
        const insertion = `${site.indent}@suppress("${code}")\n`;
        const insertAt = { line: site.line, character: 0 };

        const edit: TextEdit = {
            range: { start: insertAt, end: insertAt },
            newText: insertion,
        };

        const workspaceEdit: WorkspaceEdit = {
            changes: {
                [uri]: [edit],
            },
        };

        return {
            title: `${site.label}: @suppress("${code}")`,
            kind: SuppressCodeActionProvider.KIND,
            diagnostics: [diagnostic],
            edit: workspaceEdit,
        };
    }

    private static indentOf(line: string): string {
        const match = line.match(/^[ \t]*/);

        return match ? match[0] : '';
    }

    private static isBlankOrComment(line: string): boolean {
        const trimmed = line.trim();

        return trimmed.length === 0 || trimmed.startsWith('//');
    }
}
