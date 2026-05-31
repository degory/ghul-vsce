import {
    parseSemanticTokens,
    SEMANTIC_TOKEN_TYPES,
    SEMANTIC_TOKEN_MODIFIERS,
} from '../src/response-handler';

const typeIndex = (name: string) => SEMANTIC_TOKEN_TYPES.indexOf(name);
const modifierBit = (name: string) => 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(name);

// Compiler emits end_column 1-based INCLUSIVE — column of the last
// character. length = endCol - startCol + 1.

type Tok = {
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    token_type: string;
    modifiers: string;
};

const tok = (
    start_line: number,
    start_column: number,
    end_line: number,
    end_column: number,
    token_type: string,
    modifiers = '',
): Tok => ({ start_line, start_column, end_line, end_column, token_type, modifiers });

describe('parseSemanticTokens', () => {
    it('returns an empty data array for an empty frame', () => {
        expect(parseSemanticTokens([])).toEqual({ data: [] });
    });

    it('converts a single 1-based row to the absolute LSP encoding', () => {
        // startLine=3 startCol=5 endLine=3 endCol=10 type=class modifiers=
        // → 0-based line=2 startChar=4 length=10-5+1=6
        const result = parseSemanticTokens([tok(3, 5, 3, 10, 'class')]);

        expect(result.data).toEqual([2, 4, 6, typeIndex('class'), 0]);
    });

    it('emits length 1 for a single-character identifier (start == end)', () => {
        // A 1-char identifier at line 4 col 19 reports (4,19,4,19).
        const result = parseSemanticTokens([tok(4, 19, 4, 19, 'variable')]);

        expect(result.data).toEqual([3, 18, 1, typeIndex('variable'), 0]);
    });

    it('encodes modifiers as a bitset using the legend order', () => {
        const result = parseSemanticTokens([tok(1, 1, 1, 5, 'method', 'static')]);

        expect(result.data[4]).toBe(modifierBit('static'));
    });

    it('encodes multiple modifiers as a combined bitset', () => {
        const result = parseSemanticTokens([tok(1, 1, 1, 5, 'variable', 'static,readonly')]);

        expect(result.data[4]).toBe(modifierBit('static') | modifierBit('readonly'));
    });

    it('handles an empty modifiers field as bitset 0', () => {
        const result = parseSemanticTokens([tok(1, 1, 1, 5, 'method', '')]);

        expect(result.data[4]).toBe(0);
    });

    it('treats a missing modifiers field as bitset 0', () => {
        // `modifiers` is required by the DTO; an undefined value should still
        // be tolerated as bitset 0 rather than crash.
        const result = parseSemanticTokens([
            { start_line: 1, start_column: 1, end_line: 1, end_column: 5, token_type: 'method' } as unknown as Tok,
        ]);

        expect(result.data[4]).toBe(0);
    });

    it('delta-encodes successive tokens on the same line', () => {
        const result = parseSemanticTokens([
            tok(1, 1, 1, 5, 'class'),
            tok(1, 7, 1, 10, 'method'),
        ]);

        // class:  length=5-1+1=5, start char 0
        // method: length=10-7+1=4, deltaStart=7-1=6
        expect(result.data).toEqual([
            0, 0, 5, typeIndex('class'), 0,
            0, 6, 4, typeIndex('method'), 0,
        ]);
    });

    it('delta-encodes a token on a later line from start-of-line', () => {
        const result = parseSemanticTokens([
            tok(1, 1, 1, 5, 'class'),
            tok(3, 3, 3, 8, 'variable'),
        ]);

        // class: length 5; variable: length 8-3+1=6
        expect(result.data).toEqual([
            0, 0, 5, typeIndex('class'), 0,
            2, 2, 6, typeIndex('variable'), 0,
        ]);
    });

    it('sorts unsorted input by line then start before delta-encoding', () => {
        const result = parseSemanticTokens([
            tok(5, 1, 5, 5, 'class'),
            tok(2, 1, 2, 5, 'variable'),
            tok(2, 10, 2, 15, 'method'),
        ]);

        // Sorted: (2,1) variable len 5; (2,10) method len 6; (5,1) class len 5
        expect(result.data).toEqual([
            1, 0, 5, typeIndex('variable'), 0,
            0, 9, 6, typeIndex('method'), 0,
            3, 0, 5, typeIndex('class'), 0,
        ]);
    });

    it('skips rows whose tokenType is not in the legend', () => {
        const result = parseSemanticTokens([
            tok(1, 1, 1, 5, 'notAKind'),
            tok(2, 1, 2, 5, 'class'),
        ]);

        expect(result.data).toEqual([1, 0, 5, typeIndex('class'), 0]);
    });

    it('skips rows that span more than one line', () => {
        const result = parseSemanticTokens([
            tok(1, 1, 3, 5, 'class'),
            tok(5, 1, 5, 4, 'variable'),
        ]);

        // Only the variable; length 4-1+1=4
        expect(result.data).toEqual([4, 0, 4, typeIndex('variable'), 0]);
    });

    it('skips rows whose length is non-positive (end < start)', () => {
        const result = parseSemanticTokens([
            tok(1, 5, 1, 3, 'class'),
            tok(2, 1, 2, 5, 'variable'),
        ]);

        expect(result.data).toEqual([1, 0, 5, typeIndex('variable'), 0]);
    });

    it('skips rows with non-numeric coordinates', () => {
        const result = parseSemanticTokens([
            { ...tok(0, 1, 1, 5, 'class'), start_line: NaN } as Tok,
            tok(2, 1, 2, 5, 'variable'),
        ]);

        expect(result.data).toEqual([1, 0, 5, typeIndex('variable'), 0]);
    });

    it('skips null entries', () => {
        const result = parseSemanticTokens([
            null as unknown as Tok,
            tok(2, 1, 2, 5, 'variable'),
        ]);

        expect(result.data).toEqual([1, 0, 5, typeIndex('variable'), 0]);
    });

    it('ignores unknown modifier names while keeping known ones', () => {
        const result = parseSemanticTokens([tok(1, 1, 1, 5, 'method', 'static,bogus')]);

        expect(result.data[4]).toBe(modifierBit('static'));
    });
});
