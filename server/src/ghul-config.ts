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
		let buffer = '' + readFileSync(workspace + "/ghul.json", "utf-8").replace(/^\uFEFF/, '');
		config = <GhulConfigJson>JSON.parse(buffer);
	} else {
		console.log("no ghul.json found in " + workspace + ": using empty config");
		config = {}
	}

	let other_flags = config.other_flags ?? [];

	if (typeof other_flags == "string") {
		other_flags = (other_flags as string).split(" ").map(option => option.trim());
	}

	if (existsSync(workspace + "/.assemblies.json")) {		
		if (!other_flags.includes("--v3") ) {
			console.log("assemblies JSON found: forcing V3 mode");
			other_flags.push("--v3");
		}

		let buffer = ('' + readFileSync(workspace + "/.assemblies.json", "utf-8")).replace(/^\uFEFF/, '');

		let { assemblies } = JSON.parse(buffer) as { assemblies: string[] };
		
		for (let assembly of assemblies) {
			other_flags.push("--assembly");
			other_flags.push(assembly);
		}
	}

	let prefix = config.prefix ?? "/usr/lib/ghul/";

	if (!prefix.endsWith('/')) {
		prefix = prefix + '/';
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
