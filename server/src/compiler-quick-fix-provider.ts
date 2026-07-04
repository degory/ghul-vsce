import {
    CodeAction,
    CodeActionKind,
    Diagnostic,
    Range,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';

// LSP-shaped quick fix stashed into Diagnostic.data by the response
// handler when the compiler sends fixes with a diagnostic. The compiler
// is the sole author of fixes; this provider applies whatever arrives
// without any per-code knowledge, so new compiler quick fixes need no
// extension change.
export interface QuickFixEdit {
    range: Range;
    // Expected current text of the range, or null to skip the check
    // (insertions). The fix was computed against the last compiled
    // snapshot; if the buffer has drifted so the text no longer matches,
    // the whole fix is withheld rather than applied wrongly.
    replaces: string | null;
    newText: string;
}

export interface QuickFixData {
    title: string;
    isPreferred: boolean;
    edits: QuickFixEdit[];
}

export class CompilerQuickFixProvider {
    static readonly KIND: string = CodeActionKind.QuickFix;

    provide(document: TextDocument, uri: string, diagnostics: Diagnostic[]): CodeAction[] {
        const actions: CodeAction[] = [];
        const seen = new Set<string>();

        for (const diagnostic of diagnostics) {
            for (const fix of CompilerQuickFixProvider.fixesOf(diagnostic)) {
                if (!CompilerQuickFixProvider.editsStillApply(document, fix.edits)) {
                    continue;
                }

                const key = JSON.stringify([fix.title, fix.edits]);

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);

                actions.push(CompilerQuickFixProvider.buildAction(uri, diagnostic, fix));
            }
        }

        return actions;
    }

    // Diagnostic.data round-trips through the client as plain JSON, so
    // validate the shape rather than trusting it.
    private static fixesOf(diagnostic: Diagnostic): QuickFixData[] {
        const data = diagnostic.data as { fixes?: unknown } | undefined;

        if (!data || !Array.isArray(data.fixes)) {
            return [];
        }

        return data.fixes.filter(fix =>
            fix &&
            typeof fix.title === 'string' &&
            Array.isArray(fix.edits) &&
            fix.edits.every((edit: QuickFixEdit) =>
                edit &&
                edit.range &&
                typeof edit.newText === 'string'
            )
        );
    }

    private static editsStillApply(document: TextDocument, edits: QuickFixEdit[]): boolean {
        return edits.every(edit =>
            edit.replaces == null || document.getText(edit.range) === edit.replaces
        );
    }

    private static buildAction(uri: string, diagnostic: Diagnostic, fix: QuickFixData): CodeAction {
        const edits: TextEdit[] = fix.edits.map(edit => ({
            range: edit.range,
            newText: edit.newText,
        }));

        const workspaceEdit: WorkspaceEdit = {
            changes: {
                [uri]: edits,
            },
        };

        const action: CodeAction = {
            title: fix.title,
            kind: CompilerQuickFixProvider.KIND,
            diagnostics: [diagnostic],
            edit: workspaceEdit,
        };

        if (fix.isPreferred) {
            action.isPreferred = true;
        }

        return action;
    }
}
