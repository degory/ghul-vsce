// Computes a minimal text delta — the span of text that changed between two
// versions of the same file — so the client can send just that span rather
// than the whole file on every keystroke.
//
// The analyser retains the text the client last sent and splices the span into
// its copy, so the two must describe the same change. Deriving the span by
// comparing the texts is the safe way: it cannot get offsets wrong, where
// merging successive LSP ranges by arithmetic can — a bug there silently
// corrupts the analyser's view, and the scan this replaces is a plain
// character compare costing microseconds against the JSON-escape-and-ship
// it supersedes.

export interface EditDelta {
    path: string;
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    new_text: string;
    expected_length: number;
}

// The replaced span, in 1-based coordinates matching the analyser's convention:
// line 1 is the first line, column 1 is the first character, and the end
// position is exclusive (the character at end_column is the first one NOT
// replaced). Lines are delimited by '\n'; '\r' belongs to the line it ends.
export interface TextSpan {
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    new_text: string;
    expected_length: number;
}

// Convert a 0-based character offset to 1-based line/column, matching the
// analyser's `_offset_of` inverse (command_handlers.ghul).
function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
    let line = 1;
    let lineStart = 0;

    for (let i = 0; i < offset; i++) {
        if (text[i] === '\n') {
            line++;
            lineStart = i + 1;
        }
    }

    return { line, column: offset - lineStart + 1 };
}

// Compute the minimal span that transforms `oldText` into `newText`, expressed
// as coordinates into `oldText` (the text the analyser holds). Returns null
// when the texts are identical — there is nothing to send.
export function computeSpan(oldText: string, newText: string): TextSpan | null {
    const minLen = Math.min(oldText.length, newText.length);

    let prefixLen = 0;
    while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
        prefixLen++;
    }

    let suffixLen = 0;
    while (
        suffixLen < minLen - prefixLen &&
        oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
    ) {
        suffixLen++;
    }

    const oldEnd = oldText.length - suffixLen;

    if (prefixLen === oldEnd && prefixLen === newText.length - suffixLen) {
        return null;
    }

    const start = offsetToLineColumn(oldText, prefixLen);
    const end = offsetToLineColumn(oldText, oldEnd);
    const replacement = newText.substring(prefixLen, newText.length - suffixLen);

    return {
        start_line: start.line,
        start_column: start.column,
        end_line: end.line,
        end_column: end.column,
        new_text: replacement,
        expected_length: oldText.length
    };
}
