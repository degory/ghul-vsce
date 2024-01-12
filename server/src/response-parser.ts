import { ResponseHandler } from './response-handler';

import { log, rejectAllPendingPromises } from './server';

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
            // log("response parser: LISTEN received: compiler is listening");
            this.response_handler.handleListen();
            break;

        case "DIAG PARSE":
            // log("response parser: DIAG PARSE received");
            this.response_handler.handleDiagnosticsOld('parse', lines);
            break;

        case "DIAG ANALYSIS":
            // log("response parser: DIAG ANALYSIS received");
            this.response_handler.handleDiagnosticsOld('analysis', lines);
            break;

        // new style diagnostics:
        case "DIAGNOSTICS":
            // this.response_handler.hand
            this.response_handler.handleDiagnostics(lines);
            break;

        case "PARTIAL DONE":
            // log("response parser: PARTIAL DONE received");
            this.response_handler.handlePartialCompileDone();
            break;

        case "FULL DONE":
            // log("response parser: FULL DONE received");
            this.response_handler.handleFullCompileDone();
            break;
           
        case "HOVER":
            // log("response parser: HOVER received");
            this.response_handler.handleHover(lines);
            break;

        case "DEFINITION":
            // log("response parser: DEFINITION received");
            this.response_handler.handleDefinition(lines);
            break;

        case "DECLARATION":
            // log("response parser: DECLARATION received");
            this.response_handler.handleDeclaration(lines);
            break;
    
        case "COMPLETION":
            // log("response parser: COMPLETION received");
            this.response_handler.handleCompletion(lines);
            break;            

        case "SIGNATURE":
            // log("response parser: SIGNATURE received");
            this.response_handler.handleSignature(lines);
            break;            

        case "SYMBOLS":
            // log("response parser: SYMBOLS received");
            this.response_handler.handleSymbols(lines);
            break;            
            
        case "EXCEPT":
            // log("response parser: EXCEPT received: " + JSON.stringify(lines));
            this.response_handler.handleExcept(lines);
            break;

        case "REFERENCES":
            // log("response parser: REFERENCES received");
            this.response_handler.handleReferences(lines);
            break;

        case "IMPLEMENTATION":
            // log("response parser: IMPLEMENTATION received");
            this.response_handler.handleImplementation(lines);
            break;

        case "RENAMEREQUEST":
            this.response_handler.handleRenameRequest(lines);
            break;

        case "RESTART":
            // log("response parser: RESTART received");
            this.response_handler.handleRestart();
            break;

        default:
            // log("response parser: unrecognized command received: " + command);
            this.response_handler.handleUnexpected();
        }
    }
}