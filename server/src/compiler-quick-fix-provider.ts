import {
    CodeAction,
    CodeActionKind,
    Diagnostic,
    Range,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { DiagnosticDto } from './response-handler';

import { SeverityMapper } from './severity-map';

// LSP-shaped quick fix, converted from the wire DTO the compiler answers a
// code_actions request with. The compiler is the sole author of fixes; this
// provider applies whatever arrives without any per-code knowledge, so new
// compiler quick fixes need no extension change.
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

    provide(document: TextDocument, uri: string, diagnostics: DiagnosticDto[]): CodeAction[] {
        const actions: CodeAction[] = [];
        const seen = new Set<string>();

        for (const dto of diagnostics) {
            const diagnostic = CompilerQuickFixProvider.toDiagnostic(dto);

            for (const fix of CompilerQuickFixProvider.fixesOf(dto)) {
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

    // The wire payload is untyped JSON, so validate the shape rather than
    // trusting it.
    private static fixesOf(dto: DiagnosticDto): QuickFixData[] {
        if (!Array.isArray(dto.fixes)) {
            return [];
        }

        return dto.fixes
            .filter(fix =>
                fix &&
                typeof fix.title === 'string' &&
                Array.isArray(fix.edits) &&
                fix.edits.every(edit =>
                    edit &&
                    typeof edit.new_text === 'string' &&
                    typeof edit.start_line === 'number'
                )
            )
            .map(fix => ({
                title: fix.title,
                isPreferred: !!fix.is_preferred,
                edits: fix.edits.map(edit => ({
                    range: {
                        start: { line: edit.start_line - 1, character: edit.start_column - 1 },
                        end: { line: edit.end_line - 1, character: edit.end_column - 1 }
                    },
                    replaces: edit.replaces ?? null,
                    newText: edit.new_text
                }))
            }));
    }

    // The action's own copy of the diagnostic it resolves, so the editor can
    // tie the two together. Rebuilt from the wire rather than matched against
    // what the client already holds: an identical range and message is what
    // makes them the same diagnostic either way.
    private static toDiagnostic(dto: DiagnosticDto): Diagnostic {
        const diagnostic: Diagnostic = {
            severity: SeverityMapper.getSeverity(dto.severity, "new"),
            range: {
                start: { line: dto.start_line - 1, character: dto.start_column - 1 },
                end: { line: dto.end_line - 1, character: dto.end_column - 1 }
            },
            message: dto.message,
            source: 'ghūl'
        };

        if (dto.code) {
            diagnostic.code = dto.code;
        }

        return diagnostic;
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
