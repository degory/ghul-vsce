import { readFileSync, existsSync } from 'fs';

import { globSync } from 'glob';

import { parseString as parseXmlString } from 'xml2js';
import { log } from './log';
import { spawnSync } from 'child_process';
import { parse, quote } from 'shell-quote';

export interface GhulConfig {
	block: boolean,
	compiler: string[],
	source: string[],
	arguments: string[],
	want_plaintext_hover: boolean,
	incremental_analysis: boolean,
	// Human-readable descriptions of anything that went wrong while loading
	// the configuration — an unreadable project file, malformed JSON, no
	// compiler found. Empty when the workspace loaded cleanly. Consumers use
	// this to surface a diagnostic and to decide whether to back off rather
	// than spawn-and-fail in a loop.
	problems: string[],
}

interface GhulConfigJson {
	compiler?: string[] | string,
	source?: string[],
	other_flags?: string[] | string,
	want_plaintext_hover?: boolean,
	incremental_analysis?: boolean,
	update_compiler_tool?: boolean
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
				GhulCompiler: string[],
				UpdateCompilerTool: boolean
			}
		],
		ItemGroup: [
			{
				GhulSources: {
					"$": {
						"Include": string
					}
				}[],
				GhulOptions: {
					"$": {
						"Include": string,
						"Condition"?: string
					}
				}[]
			}
		]
	}
}

function describeError(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export function getGhulConfig(workspace: string): GhulConfig {
	let problems: string[] = [];

	let config: GhulConfigJson = {};

	if (existsSync(workspace + "/ghul.json")) {
		try {
			let buffer = '' + readFileSync(workspace + "/ghul.json", "utf-8").replace(/^\uFEFF/, '');
			config = <GhulConfigJson>JSON.parse(buffer);
		} catch (e) {
			let problem = `could not load ghul.json: ${describeError(e)}`;
			log(problem);
			problems.push(problem);
		}
	}

	let compiler: string[];

	if (config.compiler) {
		if (typeof config.compiler == "string") {
			compiler = parse(config.compiler).map(e => e.toString());
		} else {
			compiler = config.compiler;
		}
	}

	let block = false;

	if (existsSync(workspace + "/.block-compiler")) {
		block = true;
	}

	let args = config.other_flags ?? [];

	if (typeof args == "string") {
		args = parse(args as string).map(e => e.toString());
	}

	let projects = globSync(workspace + "/*.ghulproj");

	if (projects.length == 1) {
		let ghulProjFileName = projects[0];

		try {
			let buffer = '' + readFileSync(ghulProjFileName, "utf-8").replace(/^\uFEFF/, '');

			parseXmlString(buffer, (error, projectXml: GhulProjectXml) => {
				if (!error && projectXml && projectXml.Project) {
					if (!config.update_compiler_tool && projectXml.Project.PropertyGroup) {
						let updateCompilerTool =
							projectXml.Project.PropertyGroup
							.filter(pg => pg.UpdateCompilerTool)
							.map(pg => pg.UpdateCompilerTool)[0]

						if (updateCompilerTool) {
							log('will update any locally installed compiler tool to latest version');
							config.update_compiler_tool = true;
						}
					}

					if (!compiler && projectXml.Project.PropertyGroup) {
						let compilerCommandLine =
							projectXml.Project.PropertyGroup
								.filter(pg => pg.GhulCompiler)
								.map(pg => pg.GhulCompiler)
									[0]?.[0];

						if ((compilerCommandLine ?? "") != "") {
							compiler = parse(compilerCommandLine).map(e => e.toString());

							log(`will use compiler '${quote([...compiler, ...args])}' specified in ${ghulProjFileName}`);
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

					// Forward unconditioned <GhulOptions Include="…" /> so the
					// analyser tracks the command-line build (e.g. warning
					// downgrades like --warn-as-hint). These are additive to
					// other_flags and the <GhulCompiler> flags. Condition-guarded
					// options (e.g. CI-only --define) are skipped so the analyser
					// matches a local build rather than a CI build.
					if (projectXml.Project.ItemGroup) {
						projectXml.Project.ItemGroup
							.filter(ig => ig.GhulOptions)
							.map(ig => ig.GhulOptions)

							.forEach(item => {
								item
									.filter(option => option["$"]?.Include && !option["$"]?.Condition)
									.map(option => option["$"].Include)

									.forEach(include => {
										args.push(...parse(include).map(e => e.toString()));
									})
								}
							);
					}
				} else {
					let problem = `could not parse ghūl project file ${ghulProjFileName}` +
						(error ? `: ${describeError(error)}` : "");
					log(problem);
					problems.push(problem);
				}
			})
		} catch (e) {
			let problem = `could not read ghūl project file ${ghulProjFileName}: ${describeError(e)}`;
			log(problem);
			problems.push(problem);
		}
	} else if(projects.length > 0) {
		log("ignoring multiple .ghulproj files:" + projects.join(','));
	}

	if (!compiler) {
		if (existsSync(workspace + "/.config/dotnet-tools.json")) {
			try {
				let buffer = ('' + readFileSync(workspace + "/.config/dotnet-tools.json", "utf-8")).replace(/^\uFEFF/, '');

				let toolConfig = JSON.parse(buffer) as DotNetToolsJson;

				let { tools } = toolConfig;

				let ghulCompilerTool = tools["ghul.compiler"];

				if (ghulCompilerTool && ghulCompilerTool.commands.length == 1) {
					compiler = ["dotnet", "tool", "run", ghulCompilerTool.commands[0]]

					log(`will use compiler '${quote([...compiler, ...args])}' version ${ghulCompilerTool.version} from local tool manifest`);
				}
			} catch (e) {
				let problem = `could not load .config/dotnet-tools.json: ${describeError(e)}`;
				log(problem);
				problems.push(problem);
			}
		}

		if (!compiler) {
			let result = spawnSync("dotnet", ["ghul-compiler"], { encoding: "utf-8", cwd: workspace });

			if (result.status === 0 && result.stdout.startsWith("ghūl")) {
				compiler = ["dotnet", "ghul-compiler"];

				log(`will use compiler '${quote([...compiler, ...args])}'`);
			}
		}

		if (!compiler) {
			let result = spawnSync("ghul-compiler", { encoding: "utf-8", cwd: workspace });

			if (result.status === 0 && result.stdout.startsWith("ghūl")) {
				compiler = ["ghul-compiler"]

				log(`will use compiler '${quote([...compiler, ...args])}'`);
			}
		}
	}

	if (!compiler) {
		let problem = "no usable ghūl compiler found: install the ghul.compiler tool or set 'compiler' in ghul.json";
		log(problem);
		problems.push(problem);
	}

	if (config.update_compiler_tool) {
		let result = spawnSync("dotnet", ["tool", "update", "ghul.compiler", "--local"], { encoding: "utf-8", cwd: workspace });

		log(result.stdout);

		if (result.status === 0) {
			log('compiler tool update successful');
		} else {
			log(result.stderr);
			log('compiler tool update failed');
		}
	}

	if (existsSync(workspace + "/.assemblies.json")) {
		try {
			let buffer = ('' + readFileSync(workspace + "/.assemblies.json", "utf-8")).replace(/^\uFEFF/, '');

			let { assemblies } = JSON.parse(buffer) as { assemblies: string[] };

			for (let assembly of assemblies) {
				args.push("-a");
				args.push(assembly);
			}
		} catch (e) {
			let problem = `could not load .assemblies.json: ${describeError(e)}`;
			log(problem);
			problems.push(problem);
		}
	}

	args.push("-A");

	let incremental_analysis = config.incremental_analysis ?? false;

	if (incremental_analysis) {
		args.push("--incremental-analysis");
	}

	let source = [...(config.source ?? ["./**/*.ghul"])];

    return {
		block,
		compiler,
		source,
		arguments: args,
		want_plaintext_hover: config.want_plaintext_hover ?? false,
		incremental_analysis,
		problems
	};
}
