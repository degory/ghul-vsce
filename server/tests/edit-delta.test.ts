import { computeSpan } from '../src/edit-delta';

describe('computeSpan', () => {
    it('returns null when the texts are identical', () => {
        expect(computeSpan('hello', 'hello')).toBeNull();
    });

    it('computes a single-character insertion', () => {
        // 'hello' -> 'hxello' — one character inserted at position 1
        const span = computeSpan('hello', 'hxello');

        expect(span).not.toBeNull();
        expect(span!.start_line).toBe(1);
        expect(span!.start_column).toBe(2);
        expect(span!.end_line).toBe(1);
        expect(span!.end_column).toBe(2);
        expect(span!.new_text).toBe('x');
        expect(span!.expected_length).toBe(5);
    });

    it('computes a single-character deletion', () => {
        // 'hello' -> 'hllo' — one character deleted at position 1
        const span = computeSpan('hello', 'hllo');

        expect(span).not.toBeNull();
        expect(span!.start_line).toBe(1);
        expect(span!.start_column).toBe(2);
        expect(span!.end_line).toBe(1);
        expect(span!.end_column).toBe(3);
        expect(span!.new_text).toBe('');
        expect(span!.expected_length).toBe(5);
    });

    it('computes a replacement at the end of the text', () => {
        const span = computeSpan('hello world', 'hello earth');

        expect(span).not.toBeNull();
        expect(span!.start_column).toBe(7);
        expect(span!.end_column).toBe(12);
        expect(span!.new_text).toBe('earth');
    });

    it('computes a replacement on one line of a multi-line file', () => {
        // "line two" -> "CHANGED" on line 2. The \n after "two" is part of
        // the common suffix, so the span stays on line 2 rather than
        // reaching line 3.
        const oldText = 'line one\nline two\nline three';
        const newText = 'line one\nCHANGED\nline three';

        const span = computeSpan(oldText, newText);

        expect(span).not.toBeNull();
        expect(span!.start_line).toBe(2);
        expect(span!.start_column).toBe(1);
        expect(span!.end_line).toBe(2);
        expect(span!.end_column).toBe(9);
        expect(span!.new_text).toBe('CHANGED');
    });

    it('computes a zero-width insertion at end of line', () => {
        // A keystroke at the end of a line: nothing replaced, text inserted.
        // Column 6 on a 5-char line is one past the last character — the
        // analyser's end-exclusive convention admits this as valid.
        const span = computeSpan('hello\nworld', 'hellox\nworld');

        expect(span).not.toBeNull();
        expect(span!.start_line).toBe(1);
        expect(span!.start_column).toBe(6);
        expect(span!.end_line).toBe(1);
        expect(span!.end_column).toBe(6);
        expect(span!.new_text).toBe('x');
    });

    it('handles an entirely different text', () => {
        const span = computeSpan('abc', 'xyz');

        expect(span).not.toBeNull();
        expect(span!.start_line).toBe(1);
        expect(span!.start_column).toBe(1);
        expect(span!.end_line).toBe(1);
        expect(span!.end_column).toBe(4);
        expect(span!.new_text).toBe('xyz');
    });

    it('handles a change at the very end of the file', () => {
        const span = computeSpan('hello\nworld', 'hello\nworld!');

        expect(span).not.toBeNull();
        expect(span!.start_line).toBe(2);
        expect(span!.start_column).toBe(6);
        expect(span!.end_line).toBe(2);
        expect(span!.end_column).toBe(6);
        expect(span!.new_text).toBe('!');
    });

    it('reports the old text length as expected_length', () => {
        const oldText = 'abcdefghij';
        const span = computeSpan(oldText, 'abcXefghij');

        expect(span!.expected_length).toBe(oldText.length);
    });

    it('handles \\r\\n line endings without confusing the line count', () => {
        // The analyser treats \r as a regular character within the line and
        // \n as the delimiter, so a \r\n file must produce the same span as
        // the equivalent \n file for the same change.
        const oldText = 'abc\r\ndef';
        const newText = 'abX\r\ndef';

        const span = computeSpan(oldText, newText);

        expect(span).not.toBeNull();
        expect(span!.start_line).toBe(1);
        expect(span!.start_column).toBe(3);
        expect(span!.end_line).toBe(1);
        expect(span!.end_column).toBe(4);
        expect(span!.new_text).toBe('X');
    });
});
