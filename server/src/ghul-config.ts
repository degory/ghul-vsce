import { log } from 'console';
import { readFileSync, existsSync } from 'fs';

import { glob } from 'glob';

import { parseString as parseXmlString } from 'xml2js';

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

interface GhulProjectXml {
	Project: {
		"$": {
			Sdk: string
		},
		PropertyGroup: [
			{
				GhulCompiler: string[]
			}
		],
		ItemGroup: [
			{ 
				GhulSources: {
					"$": {
						"Include": string
					}
				}[]
			}
		]
	}
}

export function getGhulConfig(workspace: string): GhulConfig {
	log("getGhulConfig: " + workspace);
	
	let config: GhulConfigJson;

	if (existsSync(workspace + "/ghul.json")) {
		let buffer = '' + readFileSync(workspace + "/ghul.json", "utf-8").replace(/^\uFEFF/, '');
		config = <GhulConfigJson>JSON.parse(buffer);
	} else {
		config = {}
	}

	let args = config.other_flags ?? [];

	if (typeof args == "string") {
		args = (args as string).split(" ").map(option => option.trim());
	}

	let projects = glob.sync(workspace + "/*.ghulproj");

	if (projects.length == 1) {
		let ghulProjFileName = projects[0];

		let buffer = '' + readFileSync(ghulProjFileName, "utf-8").replace(/^\uFEFF/, '');

		parseXmlString(buffer, (error, projectXml: GhulProjectXml) => {
			if (!error && projectXml.Project) {
				if (!config.compiler && projectXml.Project.PropertyGroup) {
					let compilerCommandLine =
						projectXml.Project.PropertyGroup
							.filter(pg => pg.GhulCompiler)
							.map(pg => pg.GhulCompiler)
								[0]?.[0];

					if ((compilerCommandLine ?? "") != "") {
						let compilerCommandLineParts = compilerCommandLine.split(" ").map(s => s.trim())

						config.compiler = compilerCommandLineParts[0];

						compilerCommandLineParts.slice(1).forEach(s => args.push(s));

						console.log(`will use compiler '${compilerCommandLine}' specified in ${ghulProjFileName}`);						
					}
				}

				if (!config.source?.length && projectXml.Project.ItemGroup) {
					config.source = [];

					projectXml.Project.ItemGroup
						.filter(ig => ig.GhulSources)
						.map(ig => ig.GhulSources)

						.forEach(item => {
							item
								.filter(pattern => pattern["$"]?.Include)
								.map(pattern => pattern["$"]?.Include)
						
								.forEach(pattern => {
									config.source.push(pattern)
								})
							}
						);
				} else if(config.source) {
					config.source = config.source.map(directory => directory + "/**/*.ghul");
				}
			} else {
				console.log("failed to parse ghul project file " + ghulProjFileName);
			}
		})
	} else if(projects.length > 0) {
		console.log("ignoring multiple .ghulproj files:" + projects.join(','));
	}

	if (!config.compiler || config.compiler == "") {
		if (existsSync(workspace + "/.config/dotnet-tools.json")) {
			let buffer = ('' + readFileSync(workspace + "/.config/dotnet-tools.json", "utf-8")).replace(/^\uFEFF/, '');

			let toolConfig = JSON.parse(buffer) as DotNetToolsJson;

			let { tools } = toolConfig;

			let ghulCompilerTool = tools["ghul.compiler"]; 

			if (ghulCompilerTool && ghulCompilerTool.commands.length == 1) {
				let compilerCommand = ghulCompilerTool.commands[0];

				console.log(`will use local .NET tool compiler '${compilerCommand}' version ${ghulCompilerTool.version}`);
				config.compiler = "dotnet";

				["tool", "run", ghulCompilerTool.commands[0]].forEach(
					(a) => args.push(a)
				);
			} else {
				console.log("cannot find a useable compiler in .config/dotnet-tools.json: assuming 'ghul-compiler' is on the PATH");
			}
		} else {
			console.log("no .config/dotnet-tools.json found: assuming 'ghul-compiler' is on the PATH");
		}
	} else {
		let compilerCommandLineParts = config.compiler.split(" ").map(s => s.trim())

		config.compiler = compilerCommandLineParts[0];
		
		args.splice(1, 0, ...compilerCommandLineParts.slice(1));

		// compilerCommandLineParts.slice(1).forEach(s => args.push(s));
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

	let source = [...(config.source ?? ["./**/*.ghul"])];

    return {
		compiler: config.compiler ?? "ghul-compiler",
		source,
		arguments: args,
		want_plaintext_hover: config.want_plaintext_hover ?? false
	};
}