// import { log } from 'console';
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
	static getSeverity(severity: string|number, kind: string): DiagnosticSeverity {
		if (kind == 'parse') {
			return SeverityMapParse.get(severity as string);
		} else {
			if (typeof severity == 'number') {
				return severity as DiagnosticSeverity;
			} else if(!isNaN(Number(severity))) {
				return Number(severity) as DiagnosticSeverity;
			}

			let result = SeverityMapOther.get(severity);

			return result;
		}
	}
}