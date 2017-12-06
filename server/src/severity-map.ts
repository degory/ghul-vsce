import { DiagnosticSeverity } from 'vscode-languageserver';

export let SeverityMap = new Map<string,DiagnosticSeverity>([
	['info', DiagnosticSeverity.Information],
	['warn', DiagnosticSeverity.Warning],
	['error', DiagnosticSeverity.Error]
]);	
