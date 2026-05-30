import { ResponseHandler } from './response-handler';

import { log } from './log';

import { EditQueue } from './edit-queue';

// Each request is one JSON object per line, newline-terminated, discriminated by
// a `command` field. The compiler reads one line, deserializes it into the
// matching request type, and answers with one JSON response line (see
// response-parser.ts). Line/character positions are 1-based on the wire (the
// compiler works in 1-based coordinates; the LSP layer converts).
export class Requester {
    response_handler: ResponseHandler;
    edit_queue: EditQueue;
    child: any;

    constructor(
        response_handler: ResponseHandler
    ) {
        this.response_handler = response_handler;
    }

    setChild(child: any) {
        this.child = child;
    }

    setEditQueue(edit_queue: EditQueue) {
        this.edit_queue = edit_queue;
    }

    write(text: string) {
        try {
            if (this.child && this.child.stdin && this.child.stdin.writable) {
                this.child.stdin.write(text);
            }
        } catch(e) {
            log("could not write to compiler: " + e);
            this.edit_queue.handleConnectionLost();
        }
    }

    send(request: object) {
        this.write(JSON.stringify(request) + "\n");
    }

    sendDocuments(documents: { uri: string, source: string }[]) {
        this.send({
            command: "edit",
            files: documents.map(d => ({ path: d.uri, source: d.source }))
        });
    }

    sendEdit(uri: string, source: string) {
        this.sendDocuments([{ uri, source }]);
    }

    sendCompile() {
        this.send({ command: "compile" });
    }

    sendHover(uri: string, line: number, character: number) {
        this.send({ command: "hover", path: uri, line, column: character });
    }

    sendDefinition(uri: string, line: number, character: number) {
        this.send({ command: "definition", path: uri, line, column: character });
    }

    sendDeclaration(uri: string, line: number, character: number) {
        this.send({ command: "declaration", path: uri, line, column: character });
    }

    sendReferences(uri: string, line: number, character: number) {
        this.send({ command: "references", path: uri, line, column: character });
    }

    sendImplementation(uri: string, line: number, character: number) {
        this.send({ command: "implementation", path: uri, line, column: character });
    }

    sendTypeDefinition(uri: string, line: number, character: number) {
        this.send({ command: "type_definition", path: uri, line, column: character });
    }

    sendCompletion(uri: string, line: number, character: number) {
        this.send({ command: "complete", path: uri, line, column: character });
    }

    sendSignature(uri: string, line: number, character: number) {
        this.send({ command: "signature", path: uri, line, column: character });
    }

    sendSymbols(uri: string) {
        this.send({ command: "symbols", path: uri });
    }

    sendWorkspaceSymbols() {
        this.send({ command: "symbols", path: "" });
    }

    sendRenameRequest(uri: string, line: number, character: number, newName: string) {
        this.send({ command: "rename", path: uri, line, column: character, new_name: newName });
    }

    sendSemanticTokens(uri: string) {
        this.send({ command: "semantic_tokens", path: uri });
    }

    sendFormat(uri: string, source: string) {
        this.send({ command: "format", path: uri, source });
    }

    sendFormatRange(uri: string, startLine: number, startCharacter: number, endLine: number, endCharacter: number, source: string) {
        this.send({
            command: "format_range",
            path: uri,
            start_line: startLine,
            start_column: startCharacter,
            end_line: endLine,
            end_column: endCharacter,
            source
        });
    }

    sendHeapCheck() {
        this.send({ command: "heap_check" });
    }

    sendRestart() {
        this.send({ command: "restart" });
    }
}
