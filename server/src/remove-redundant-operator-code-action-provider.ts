import {
    CodeAction,
    CodeActionKind,
    Diagnostic,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Offers "remove the redundant operator" fixes for the compiler's
// redundancy warnings. The compiler reports each of these on the whole
// operator expression, with the range ending at the operator itself
// ('x!', 'x?') or spanning the member access ('x?.y'), so the edit is
// derived from the diagnostic range's text rather than a re-parse.
export class RemoveRedundantOperatorCodeActionProvider {
    static readonly KIND: string = CodeActionKind.QuickFix;

    // Diagnostic codes whose fix is deleting the trailing postfix
    // operator, keyed to the operator character to delete.
    private static readonly POSTFIX_OPERATORS: Map<string, string> = new Map([
        ['redundant-presence-test', '?'],
        ['redundant-unwrap', '!'],
    ]);

    private static readonly COALESCE_CODE = 'redundant-coalesce';

    provide(document: TextDocument, uri: string, diagnostics: Diagnostic[]): CodeAction[] {
        const actions: CodeAction[] = [];
        const seen = new Set<string>();

        for (const diagnostic of diagnostics) {
            const code = RemoveRedundantOperatorCodeActionProvider.codeOf(diagnostic);

            if (!code) {
                continue;
            }

            const action = this.actionFor(document, uri, diagnostic, code);

            if (!action) {
                continue;
            }

            const key =
                code + '@' +
                diagnostic.range.start.line + ',' + diagnostic.range.start.character + '..' +
                diagnostic.range.end.line + ',' + diagnostic.range.end.character;

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);

            actions.push(action);
        }

        return actions;
    }

    private static codeOf(diagnostic: Diagnostic): string | null {
        const code = diagnostic.code;

        if (typeof code === 'string' && code.length > 0) {
            return code;
        }

        return null;
    }

    private actionFor(document: TextDocument, uri: string, diagnostic: Diagnostic, code: string): CodeAction | null {
        const operator = RemoveRedundantOperatorCodeActionProvider.POSTFIX_OPERATORS.get(code);

        if (operator) {
            return this.removePostfixOperator(document, uri, diagnostic, operator);
        }

        if (code == RemoveRedundantOperatorCodeActionProvider.COALESCE_CODE) {
            return this.removeCoalesceOperator(document, uri, diagnostic);
        }

        return null;
    }

    // 'x!' / 'x?' — the operator is the last non-whitespace character of
    // the diagnostic range. If the range text does not end with the
    // expected operator, offer nothing rather than a wrong edit.
    private removePostfixOperator(document: TextDocument, uri: string, diagnostic: Diagnostic, operator: string): CodeAction | null {
        const rangeText = document.getText(diagnostic.range);
        const trimmed = rangeText.replace(/\s+$/, '');

        if (!trimmed.endsWith(operator)) {
            return null;
        }

        const operatorOffset = document.offsetAt(diagnostic.range.start) + trimmed.length - 1;

        return this.buildAction(
            document,
            uri,
            diagnostic,
            `Remove redundant '${operator}'`,
            operatorOffset
        );
    }

    // 'x?.y' — deleting the '?' of the one '?.' in the range turns the
    // conditional access into a plain one. A range holding more than one
    // '?.' (a chain reported on its outermost member) is ambiguous, so
    // offer nothing.
    private removeCoalesceOperator(document: TextDocument, uri: string, diagnostic: Diagnostic): CodeAction | null {
        const rangeText = document.getText(diagnostic.range);
        const first = rangeText.indexOf('?.');

        if (first < 0 || rangeText.indexOf('?.', first + 1) >= 0) {
            return null;
        }

        const operatorOffset = document.offsetAt(diagnostic.range.start) + first;

        return this.buildAction(
            document,
            uri,
            diagnostic,
            "Replace '?.' with '.'",
            operatorOffset
        );
    }

    private buildAction(document: TextDocument, uri: string, diagnostic: Diagnostic, title: string, operatorOffset: number): CodeAction {
        const edit: TextEdit = {
            range: {
                start: document.positionAt(operatorOffset),
                end: document.positionAt(operatorOffset + 1),
            },
            newText: '',
        };

        const workspaceEdit: WorkspaceEdit = {
            changes: {
                [uri]: [edit],
            },
        };

        return {
            title,
            kind: RemoveRedundantOperatorCodeActionProvider.KIND,
            diagnostics: [diagnostic],
            isPreferred: true,
            edit: workspaceEdit,
        };
    }
}
