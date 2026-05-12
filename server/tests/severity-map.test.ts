import { DiagnosticSeverity } from 'vscode-languageserver';

import { SeverityMapper } from '../src/severity-map';

describe('SeverityMapper', () => {
    describe('kind = parse', () => {
        it.each([
            ['info', DiagnosticSeverity.Information],
            ['warn', DiagnosticSeverity.Warning],
            ['error', DiagnosticSeverity.Error],
        ])('maps %s to severity %s', (severity, expected) => {
            expect(SeverityMapper.getSeverity(severity, 'parse')).toBe(expected);
        });

        it('returns undefined for unknown severity', () => {
            expect(SeverityMapper.getSeverity('unknown', 'parse')).toBeUndefined();
        });
    });

    describe('kind != parse', () => {
        it.each([
            ['info', DiagnosticSeverity.Information],
            ['warn', DiagnosticSeverity.Warning],
            ['error', DiagnosticSeverity.Error],
        ])('maps %s to severity %s for non-parse kind', (severity, expected) => {
            expect(SeverityMapper.getSeverity(severity, 'new')).toBe(expected);
        });

        it('passes through numeric severity', () => {
            expect(SeverityMapper.getSeverity(2, 'new')).toBe(2);
        });

        it('parses numeric-string severity to number', () => {
            expect(SeverityMapper.getSeverity('3', 'new')).toBe(3);
        });

        it('returns undefined for unknown non-numeric severity', () => {
            expect(SeverityMapper.getSeverity('unknown', 'new')).toBeUndefined();
        });
    });
});
