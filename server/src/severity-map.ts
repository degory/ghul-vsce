import { log } from 'console';
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
		log("severity mapper: getSeverity: '" + severity + "' " + kind);

		if (typeof severity == 'number') {
			log("severity mapper: getSeverity: number: ", severity);

			return severity as DiagnosticSeverity;
		} else if(!isNaN(Number(severity))) {
			log("severity mapper: getSeverity: number: ", severity);

			return Number(severity) as DiagnosticSeverity;
		}

		if (kind == 'parse') {
			return SeverityMapParse.get(severity);
		} else {
			let result = SeverityMapOther.get(severity);

			log("severity mapper: getSeverity: other: ", result);

			return result;
		}
	}
}