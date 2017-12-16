import { ResponseHandler } from './response-handler';

import { log } from './server';

export class ResponseParser {
    buffer: string;
    response_handler: ResponseHandler;

    constructor(response_handler: ResponseHandler) {

        console.info("starting up");
        this.buffer = '';
        this.response_handler = response_handler;
    }

    handleChunk(chunk: string) {
		this.buffer += chunk;

		let sections = this.buffer.split('\f');

		if (sections.length > 1) {
			let lastIndex = sections.length - 1;

			for (var i = 0; i < lastIndex; i++) {
				let section = sections[i];

				if (section.length > 0) {
					this.handleSection(section);
				} else {
					log("protocol error: empty section");
					break;
				}
			}

			this.buffer = sections[lastIndex];
		}
    }
    
    handleSection(section: String) {
        let lines = section.split('\n');

        if (lines.length < 2) {
            log("protocol error: no command received");
            return;
        }

        let command = lines[0].trim();

        lines.shift(); // remove command
        lines.pop(); // remove empty terminator

        switch (command) {
        case "LISTEN":
            log("LISTEN received: compiler is listening");
            this.response_handler.handleListen();
            break;

        case "DIAG PARSE":
            log("DIAG PARSE received");
            this.response_handler.handleDiagnostics('parse', lines);
            break;

        case "DIAG ANALYSIS":
            log("DIAG ANALYSIS received");
            this.response_handler.handleDiagnostics('analyis', lines);
            break;

        case "ANALYSED":
            log("ANALYSED received");
            this.response_handler.handleAnalysed();
            break;            

        case "HOVER":
            log("HOVER received");
            this.response_handler.handleHover(lines);
            break;

        case "DEFINITION":
            log("DEFINITION received");
            this.response_handler.handleDefinition(lines);
            break;

        case "COMPLETION":
            log("COMPLETION received");
            this.response_handler.handleCompletion(lines);
            break;            

        case "SIGNATURE":
            log("SIGNATURE received");
            this.response_handler.handleSignature(lines);
            break;            

        case "EXCEPT":
            log("EXCEPT received: " + JSON.stringify(lines));
            this.response_handler.handleExcept(lines);
            break;

        default:
            log("unexpected command received: " + command);
            this.response_handler.handleUnexpected();
        }
    }
}