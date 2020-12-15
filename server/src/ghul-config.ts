import { readFileSync, existsSync } from 'fs';

export interface GhulConfig {
	compiler: string,
	source: string[],
	other_flags: string[],
	want_plaintext_hover: boolean,
}

interface GhulConfigJson {
	compiler?: string,
	source?: string[],
	libraries?: string[] | null,
	other_flags?: string[],
	prefix?: string,
	want_plaintext_hover?: boolean,
}

export function getGhulConfig(workspace: string): GhulConfig {
	let config: GhulConfigJson;


	if (existsSync(workspace + "/ghul.json")) {
		let buffer = '' + readFileSync(workspace + "/ghul.json");
		config = <GhulConfigJson>JSON.parse(buffer);
	} else {
		console.log("no ghul.json found in " + workspace + ": using empty config");
		config = {}
	}

	let prefix = config.prefix ?? "/usr/lib/ghul/";

	if (!prefix.endsWith('/')) {
		prefix = prefix + '/';
	}

	let other_flags = config.other_flags ?? [];

	if (typeof other_flags == "string") {
		other_flags = (other_flags as string).split(" ").map(option => option.trim());
	}

	// FIXME: avoid duplicating this between the VSCE and the compiler:
	let default_libraries;
	
	
	if (other_flags.find(flag => flag == '--v3')) {
		default_libraries = ["dotnet/ghul"];
	} else {
		default_libraries = ["dotnet/ghul", "dotnet/stubs"]; 
	}

	let libraries = 
		(config.libraries ?? default_libraries)
			.map(
				library => 
					!library.startsWith('/') && !library.startsWith('.') ?
						prefix + library
					:
						library					
				);

	let source = [...libraries, ...(config.source ?? ["."])];


    return {
		compiler: config.compiler ?? "/usr/bin/ghul",
		source,
		other_flags,
		want_plaintext_hover: config.want_plaintext_hover ?? false
	};
}
