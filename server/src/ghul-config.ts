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
		config = {}
	}

	let prefix = config.prefix ?? "/usr/lib/ghul/";

	if (!prefix.endsWith('/')) {
		prefix = prefix + '/';
	}

	// FIXME: avoid duplicating this between the VSCE and the compiler:
	let default_libraries = ["dotnet/ghul", "dotnet/stubs"];

	let libraries = 
		(config.libraries ?? default_libraries)
			.map(
				library => 
					!library.startsWith('/') && !library.startsWith('.') ?
						prefix + library
					:
						library					
				);

	console.log("libraries is: ", libraries);

	let source = [...libraries, ...(config.source ?? ["."])];

	console.log("source including libraries is: ", source);

	console.log("compiler is: " + config.compiler);

	let other_flags = config.other_flags ?? [];

	if (typeof other_flags == "string") {
		other_flags = [other_flags] as string[];
	}

    return {
		compiler: config.compiler ?? "/usr/bin/ghul.exe",
		source,
		other_flags,
		want_plaintext_hover: config.want_plaintext_hover ?? false
	};
}
