import { Diagnostic } from 'vscode-languageserver';

import { log } from './server';

interface DiagnosticList {
	uri: string;
	diagnostics: Diagnostic[]
}

class ProblemList {
	parse: Diagnostic[];
	analysis: Diagnostic[];

	constructor() {
		this.parse = [];
		this.analysis = [];
	}

	add_parse_problem(diagnostic: Diagnostic) {
		this.parse.push(diagnostic);
	}

	add_analysis_problem(diagnostic: Diagnostic) {
		this.analysis.push(diagnostic);
	}	

	clear_parse_problems() {
		this.parse = [];

		// FIXME: should I be doing this here?
		this.analysis = [];		
	}

	clear_analysis_problems() {
		this.analysis = [];
	}

	all(): Diagnostic[] {
		return this.parse.concat(this.analysis);
	}
}

export class ProblemStore {
	problems: Map<string,ProblemList>;

	constructor() {
		this.problems = new Map<string,ProblemList>();
	}

	get_problem_list_for(uri: string): ProblemList {
		if (this.problems.has(uri)) {
			return this.problems.get(uri);
		} else {
			let result = new ProblemList();
			this.problems.set(uri, result);

			return result;
		}
	}

	add(kind: string, uri: string, diagnostic: Diagnostic) {
		if (kind == 'parse') {
			this.add_parse_problem(uri, diagnostic);
		} else if (kind == 'analysis') {
			this.add_analysis_problem(uri, diagnostic);
		} else {
			log("unknown diagnostic: " + kind);
		}
	}

	add_parse_problem(uri: string, diagnostic: Diagnostic) {
		this.get_problem_list_for(uri).add_parse_problem(diagnostic);
	}

	add_analysis_problem(uri: string, diagnostic: Diagnostic) {
		this.get_problem_list_for(uri).add_analysis_problem(diagnostic);
	}

	clear() {
		this.problems.clear();
	}

	clear_parse_problems(uri: string) {
		let pl = this.get_problem_list_for(uri);

		pl.clear_parse_problems();
	}

	clear_analysis_problems(uri: string) {
		let pl = this.get_problem_list_for(uri);

		pl.clear_analysis_problems();
	}	

	clear_all_analysis_problems() {
		for (let uri of this.problems.keys()) {
			let pl = this.get_problem_list_for(uri);

			pl.clear_analysis_problems();
		}
	}

	*[Symbol.iterator](): Iterator<DiagnosticList> {
		for (let v of this.problems.entries()) {
			yield { uri: v[0], diagnostics: v[1].all() };
		}	
	}
}

