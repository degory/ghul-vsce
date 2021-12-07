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

interface DotNetToolsJson {
	version: number,
	isRoot: boolean,
	tools: {
		[name: string]: {
			version: string,
			commands: string[]
		}
	}
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

	if (existsSync(workspace + "/.config/dotnet-tools.json")) {
		let buffer = ('' + readFileSync(workspace + "/.config/dotnet-tools.json", "utf-8")).replace(/^\uFEFF/, '');

		let toolConfig = JSON.parse(buffer) as DotNetToolsJson;

		let { tools } = toolConfig;

		let ghulCompilerTool = tools["ghul.compiler"]; 

		if (ghulCompilerTool && ghulCompilerTool.commands.length == 1) {
			let compilerCommand = ghulCompilerTool.commands[0];

			console.log("using local .NET tool compiler installation " + compilerCommand + " version " + ghulCompilerTool.version);
			config.compiler = "dotnet";

			["tool", "run", ghulCompilerTool.commands[0]].forEach(
				(a) => args.push(a)
			);
		} else {
			console.log("Cannot find a useable compiler in .config/dotnet-tools.json. Will look for globally installed compiler on PATH");
		}
	} else {
		console.log("No .config/dotnet-tools.json found. Will look for globally installed compiler on PATH");
	}

	if (existsSync(workspace + "/.assemblies.json")) {		
		let buffer = ('' + readFileSync(workspace + "/.assemblies.json", "utf-8")).replace(/^\uFEFF/, '');

		let { assemblies } = JSON.parse(buffer) as { assemblies: string[] };
		
		for (let assembly of assemblies) {
			args.push("-a");
			args.push(assembly);
		}
	}

	args.push("-A");

	let source = [...(config.source ?? ["."])];

    return {
		compiler: config.compiler ?? "ghul-compiler",
		source,
		arguments: args,
		want_plaintext_hover: config.want_plaintext_hover ?? false
	};
}
