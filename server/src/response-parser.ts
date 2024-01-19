import { ResponseHandler } from './response-handler';

import { log } from './log';
import { rejectAllPendingPromises } from './extension-state';

export class ResponseParser {
    buffer: string;
    response_handler: ResponseHandler;

    constructor(
        response_handler: ResponseHandler
    ) {
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
                    log("response parser: protocol error: empty section " + i + " of " + lastIndex);
                    rejectAllPendingPromises("response parser: protocol error: empty section " + i + " of " + lastIndex);
				}
			}

			this.buffer = sections[lastIndex];
		}
    }
    
    handleSection(section: String) {
        let lines = section.split('\n');

        if (lines.length < 2) {
            log("response parser: protocol error: no command received");
            rejectAllPendingPromises("response parser: protocol error: no command received");
            return;
        }

        let command = lines[0].trim();

        lines.shift(); // remove command
        lines.pop(); // remove empty terminator

        switch (command) {
        case "LISTEN":
            this.response_handler.handleListen();
            break;

        // new style diagnostics:
        case "DIAGNOSTICS":
            this.response_handler.handleDiagnostics(lines);
            break;

        case "PARTIAL DONE":
            this.response_handler.handlePartialCompileDone();
            break;

        case "FULL DONE":
            this.response_handler.handleFullCompileDone();
            break;
           
        case "HOVER":
            this.response_handler.handleHover(lines);
            break;

        case "DEFINITION":
            this.response_handler.handleDefinition(lines);
            break;

        case "DECLARATION":
            this.response_handler.handleDeclaration(lines);
            break;
    
        case "COMPLETION":
            this.response_handler.handleCompletion(lines);
            break;            

        case "SIGNATURE":
            this.response_handler.handleSignature(lines);
            break;            

        case "SYMBOLS":
            this.response_handler.handleSymbols(lines);
            break;            
            
        case "EXCEPT":
            this.response_handler.handleExcept(lines);
            break;

        case "REFERENCES":
            this.response_handler.handleReferences(lines);
            break;

        case "IMPLEMENTATION":
            this.response_handler.handleImplementation(lines);
            break;

        case "RENAMEREQUEST":
            this.response_handler.handleRenameRequest(lines);
            break;

        case "RESTART":
            this.response_handler.handleRestart();
            break;

        default:
            this.response_handler.handleUnexpected();
        }
    }
}