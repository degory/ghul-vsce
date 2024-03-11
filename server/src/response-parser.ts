import { ResponseHandler } from './response-handler';

import { log } from './log';
import { clearWatchdog, rejectAllPendingPromises } from './extension-state';

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
        chunk = chunk.replace(/\r/g, '');

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
            clearWatchdog();

            this.response_handler.handleListen();
            break;

        // new style diagnostics:
        case "DIAGNOSTICS":
            clearWatchdog();

            this.response_handler.handleDiagnostics(lines);
            break;

        case "PARTIAL DONE":
            clearWatchdog();

            this.response_handler.handlePartialCompileDone(lines);
            break;

        case "FULL DONE":
            clearWatchdog();

            this.response_handler.handleFullCompileDone(lines);
            break;
           
        case "HOVER":
            clearWatchdog();

            this.response_handler.handleHover(lines);
            break;

        case "DEFINITION":
            clearWatchdog();

            this.response_handler.handleDefinition(lines);
            break;

        case "DECLARATION":
            clearWatchdog();

            this.response_handler.handleDeclaration(lines);
            break;
    
        case "COMPLETION":
            clearWatchdog();

            this.response_handler.handleCompletion(lines);
            break;            

        case "SIGNATURE":
            clearWatchdog();

            this.response_handler.handleSignature(lines);
            break;            

        case "SYMBOLS":
            clearWatchdog();

            this.response_handler.handleSymbols(lines);
            break;            
            
        case "EXCEPT":
            clearWatchdog();

            this.response_handler.handleExcept(lines);
            break;

        case "REFERENCES":
            clearWatchdog();

            this.response_handler.handleReferences(lines);
            break;

        case "IMPLEMENTATION":
            clearWatchdog();

            this.response_handler.handleImplementation(lines);
            break;

        case "RENAMEREQUEST":
            clearWatchdog();

            this.response_handler.handleRenameRequest(lines);
            break;

        case "RESTART":
            clearWatchdog();

            this.response_handler.handleRestart();
            break;

        default:
            // not a known command, but compiler presumably still alive
            clearWatchdog();

            this.response_handler.handleUnexpected();
        }
    }
}