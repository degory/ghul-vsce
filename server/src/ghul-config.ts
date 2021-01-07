// import { Console } from 'console';
import { readFileSync, existsSync } from 'fs';

export interface GhulConfig {
	compiler: string,
	source: string[],
	arguments: string[],
	want_plaintext_hover: boolean,
}

interface GhulConfigJson {
	compiler?: string,
	source?: string[],
	other_flags?: string[],
	want_plaintext_hover?: boolean,
}

export function getGhulConfig(workspace: string): GhulConfig {
	let config: GhulConfigJson;

	if (existsSync(workspace + "/ghul.json")) {
		let buffer = '' + readFileSync(workspace + "/ghul.json", "utf-8").replace(/^\uFEFF/, '');
		config = <GhulConfigJson>JSON.parse(buffer);
	} else {
		console.log("no ghul.json found in " + workspace + ": using empty config");
		config = {}
	}

	let args = config.other_flags ?? [];

	if (typeof args == "string") {
		args = (args as string).split(" ").map(option => option.trim());
	}

	if (existsSync(workspace + "/.assemblies.json")) {		
		let buffer = ('' + readFileSync(workspace + "/.assemblies.json", "utf-8")).replace(/^\uFEFF/, '');

		let { assemblies } = JSON.parse(buffer) as { assemblies: string[] };
		
		for (let assembly of assemblies) {
			args.push("-a");
			args.push(assembly);
		}
	}

	let source = [...(config.source ?? ["."])];

    return {
		compiler: config.compiler ?? "ghul-compiler",
		source,
		arguments: args,
		want_plaintext_hover: config.want_plaintext_hover ?? false
	};
}
