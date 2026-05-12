import { normalizeFileUri } from '../src/normalize-file-uri';

describe('normalizeFileUri', () => {
    it('round-trips a Unix file uri unchanged', () => {
        expect(normalizeFileUri('file:///path/to/file.ghul'))
            .toBe('file:///path/to/file.ghul');
    });

    it('preserves a literal colon in a Windows-style uri', () => {
        expect(normalizeFileUri('file:///C:/path/to/file.ghul'))
            .toBe('file:///C:/path/to/file.ghul');
    });

    it('decodes a percent-encoded colon in a Windows-style uri', () => {
        expect(normalizeFileUri('file:///C%3A/path/to/file.ghul'))
            .toBe('file:///C:/path/to/file.ghul');
    });

    it('produces the same result for encoded and unencoded forms of the same path', () => {
        expect(normalizeFileUri('file:///C%3A/x.ghul'))
            .toBe(normalizeFileUri('file:///C:/x.ghul'));
    });
});
