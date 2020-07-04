import { DiagnosticSeverity } from 'vscode-languageserver';

let SeverityMapParse = new Map<string,DiagnosticSeverity>([
	['info', DiagnosticSeverity.Information],
	['warn', DiagnosticSeverity.Warning],
	['error', DiagnosticSeverity.Error ]
]);	

let SeverityMapOther = new Map<string,DiagnosticSeverity>([
	['info', DiagnosticSeverity.Information],
	['warn', DiagnosticSeverity.Warning],
	['error', DiagnosticSeverity.Error]
]);	

export class SeverityMapper {
	static getSeverity(severity: string, kind: string): DiagnosticSeverity {
		if (kind == 'parse') {
			return SeverityMapParse.get(severity);
		} else {
			return SeverityMapOther.get(severity);
		}
	}
}