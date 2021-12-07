// import { Console } from 'console';
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

	let projects = glob.sync(workspace + "/*.ghulproj");

	if (projects.length == 1) {
		let projectFileName = projects[0];

		let buffer = '' + readFileSync(projectFileName, "utf-8").replace(/^\uFEFF/, '');

		parseXmlString(buffer, (error, projectXml: GhulProjectXml) => {
			if (!error && projectXml.Project) {
				console.log("have read ghul project XML file:\n" + JSON.stringify(projectXml));

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

						console.log(`Will use compiler ${compilerCommandLine} specified in ${projectFileName}`);						
					}
				}

				console.log("config.source initially: " + JSON.stringify(config.source));
				console.log("projectXml.Project.ItemGroup initially: " + JSON.stringify(projectXml.Project.ItemGroup));

				if (!config.source?.length && projectXml.Project.ItemGroup) {
					console.log("look for source patterns...");

					config.source = [];

					projectXml.Project.ItemGroup
						.filter(ig => ig.GhulSources)
						.map(ig => ig.GhulSources)

						.forEach(item => {
							console.log("look for glob patterns in: " + JSON.stringify(item));

							item
								.filter(pattern => pattern["$"]?.Include)
								.map(pattern => pattern["$"]?.Include)
						
								.forEach(pattern => {
									console.log("add source glob pattern: " + pattern);
									config.source.push(pattern)
								})
							}
						);
				}
			} else {
				console.log("failed to parse ghul project file:\n" + buffer);
			}
		})
	} else if(projects.length > 0) {
		console.log("ignoring multiple .ghulproj files:" + projects.join(','));
	}

	if (!config.compiler) {
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
