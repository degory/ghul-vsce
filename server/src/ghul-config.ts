import { readFileSync, existsSync } from 'fs';

export interface GhulConfig {
	compiler: string,
	use_docker: boolean,
	source: string[],
	other_flags: string[],
}

interface GhulConfigJson {
	compiler?: string,
	use_docker?: boolean,
	source?: string[],
	libraries?: string[] | null,
	other_flags?: string[],
	target?: "dotnet" | "legacy",
	prefix?: string
}


export function getGhulConfig(workspace: string): GhulConfig {
	let config: GhulConfigJson;

	if (existsSync(workspace + "/ghul.json")) {
		let buffer = '' + readFileSync(workspace + "/ghul.json");
		config = <GhulConfigJson>JSON.parse(buffer);
	} else {
		config = {}
	}

	let target = config.target ?? "dotnet";

	let prefix = config.prefix ?? "/usr/lib/ghul/";

	if (!prefix.endsWith('/')) {
		prefix = prefix + '/';
	}

	// FIXME: avoid duplicating this between the VSCE and the compiler:
	let default_libraries = target == "dotnet" ?
		["dotnet/ghul", "dotnet/stubs"]
	:
		["legacy/ghul"];

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

	let other_flags = config.other_flags ?? [];

	if (typeof other_flags == "string") {
		other_flags = [other_flags] as string[];
	}

	if (target != "dotnet") {
		other_flags.push("-L");
	}
    
    return {
		use_docker: false,
		compiler: "/usr/bin/ghul",
		source,
		other_flags
	};
}
