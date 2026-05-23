import {
    parseSemanticTokens,
    SEMANTIC_TOKEN_TYPES,
    SEMANTIC_TOKEN_MODIFIERS,
} from '../src/response-handler';

const typeIndex = (name: string) => SEMANTIC_TOKEN_TYPES.indexOf(name);
const modifierBit = (name: string) => 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(name);

// Compiler emits end_column 1-based INCLUSIVE — column of the last
// character. length = endCol - startCol + 1.

describe('parseSemanticTokens', () => {
    it('returns an empty data array for an empty frame', () => {
        expect(parseSemanticTokens([])).toEqual({ data: [] });
    });

    it('converts a single 1-based row to the absolute LSP encoding', () => {
        // startLine=3 startCol=5 endLine=3 endCol=10 type=class modifiers=
        // → 0-based line=2 startChar=4 length=10-5+1=6
        const result = parseSemanticTokens(['3\t5\t3\t10\tclass\t']);

        expect(result.data).toEqual([2, 4, 6, typeIndex('class'), 0]);
    });

    it('emits length 1 for a single-character identifier (start == end)', () => {
        // A 1-char identifier at line 4 col 19 reports `4\t19\t4\t19`.
        const result = parseSemanticTokens(['4\t19\t4\t19\tvariable\t']);

        expect(result.data).toEqual([3, 18, 1, typeIndex('variable'), 0]);
    });

    it('encodes modifiers as a bitset using the legend order', () => {
        const result = parseSemanticTokens(['1\t1\t1\t5\tmethod\tstatic']);

        expect(result.data[4]).toBe(modifierBit('static'));
    });

    it('encodes multiple modifiers as a combined bitset', () => {
        const result = parseSemanticTokens(['1\t1\t1\t5\tvariable\tstatic,readonly']);

        expect(result.data[4]).toBe(modifierBit('static') | modifierBit('readonly'));
    });

    it('handles an empty modifiers field as bitset 0', () => {
        const result = parseSemanticTokens(['1\t1\t1\t5\tmethod\t']);

        expect(result.data[4]).toBe(0);
    });

    it('handles a missing modifiers field as bitset 0', () => {
        const result = parseSemanticTokens(['1\t1\t1\t5\tmethod']);

        expect(result.data[4]).toBe(0);
    });

    it('delta-encodes successive tokens on the same line', () => {
        const result = parseSemanticTokens([
            '1\t1\t1\t5\tclass\t',
            '1\t7\t1\t10\tmethod\t',
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
            '1\t1\t1\t5\tclass\t',
            '3\t3\t3\t8\tvariable\t',
        ]);

        // class: length 5; variable: length 8-3+1=6
        expect(result.data).toEqual([
            0, 0, 5, typeIndex('class'), 0,
            2, 2, 6, typeIndex('variable'), 0,
        ]);
    });

    it('sorts unsorted input by line then start before delta-encoding', () => {
        const result = parseSemanticTokens([
            '5\t1\t5\t5\tclass\t',
            '2\t1\t2\t5\tvariable\t',
            '2\t10\t2\t15\tmethod\t',
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
            '1\t1\t1\t5\tnotAKind\t',
            '2\t1\t2\t5\tclass\t',
        ]);

        expect(result.data).toEqual([1, 0, 5, typeIndex('class'), 0]);
    });

    it('skips rows that span more than one line', () => {
        const result = parseSemanticTokens([
            '1\t1\t3\t5\tclass\t',
            '5\t1\t5\t4\tvariable\t',
        ]);

        // Only the variable; length 4-1+1=4
        expect(result.data).toEqual([4, 0, 4, typeIndex('variable'), 0]);
    });

    it('skips rows whose length is non-positive (end < start)', () => {
        const result = parseSemanticTokens([
            '1\t5\t1\t3\tclass\t',
            '2\t1\t2\t5\tvariable\t',
        ]);

        expect(result.data).toEqual([1, 0, 5, typeIndex('variable'), 0]);
    });

    it('skips rows with non-numeric coordinates', () => {
        const result = parseSemanticTokens([
            'oops\t1\t1\t5\tclass\t',
            '2\t1\t2\t5\tvariable\t',
        ]);

        expect(result.data).toEqual([1, 0, 5, typeIndex('variable'), 0]);
    });

    it('skips empty rows', () => {
        const result = parseSemanticTokens(['', '2\t1\t2\t5\tvariable\t']);

        expect(result.data).toEqual([1, 0, 5, typeIndex('variable'), 0]);
    });

    it('ignores unknown modifier names while keeping known ones', () => {
        const result = parseSemanticTokens(['1\t1\t1\t5\tmethod\tstatic,bogus']);

        expect(result.data[4]).toBe(modifierBit('static'));
    });
});
