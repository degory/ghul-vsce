import { readFileSync } from 'fs';

import { log } from './server';

export interface GhulConfig {
	use_docker: boolean,
	ghul_lib: string,
	ghul_source: string[],
	ghul_compiler: string,	
	other_flags: string
}

export function getGhulConfig(workspace: string): GhulConfig {
	let buffer = '' + readFileSync(workspace + "/ghul.json");
	let config = <GhulConfig>JSON.parse(buffer);
    
    return config;
}
