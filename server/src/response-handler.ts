import {
    Connection,
    CompletionItem,
    CompletionItemKind,
    Definition,
    SemanticTokens,
    SemanticTokensLegend,
    SignatureHelp,
    SymbolKind,
    Hover,
    SignatureInformation,
    ParameterInformation,
    SymbolInformation,
    Location,
    WorkspaceEdit,
    TextEdit,
    Range,
    Diagnostic,
} from 'vscode-languageserver';

import { log } from './log';

import { rejectAllAndThrow } from './extension-state';

import { normalizeFileUri } from './normalize-file-uri';

import { SeverityMapper } from './severity-map';

import { ServerManager } from './server-manager';

import { EditQueue } from './edit-queue';
import { ConfigEventEmitter } from './config-event-emitter';
import { GhulConfig } from './ghul-config';

type ResolveReject<T> = {
    resolve: (value: T) => void;
    reject: (error: any) => void;
}

class PromiseQueue<T> {
    _name: string;
    _queue: ResolveReject<T>[];

    constructor(name: string) {
        this._name = name;
        this._queue = [];
    }

    enqueue(): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this._queue.push({resolve, reject});
        })
    }

    dequeue(): ResolveReject<T> {
        // compiler is guaranteed to respond to requests in the order they were
        // sent, so safe to just dequeue the next pending promise:
        return this._queue.shift();
    }

    dequeueAlways(): ResolveReject<T> {
        // compiler is guaranteed to respond to requests in the order they were
        // sent, so safe to just dequeue the next pending promise:
        return (
            this._queue.shift() ?? 
            {
                resolve: value => console.log(this._name + ": oops: unexpected resolve: " + JSON.stringify(value)),
                reject: error => console.log(this._name + ": oops: unexpected reject: " + error)
            }
        );
    }

    isEmpty(): boolean {
        return this._queue.length == 0;
    }

    resolve(value: T) {
        this.dequeueAlways().resolve(value);
    }

    reject(error: any) {
        console.log(this._name + ": will reject: " + error);

        this.dequeueAlways().reject(error);
    }

    resolveAll(value: T) {
        for (let entry = this.dequeue(); entry; entry = this.dequeue() ) {
            entry.resolve(value);
        }
    }

    rejectAll(error: any) {
        console.log(this._name + ": will reject ALL: " + error);

        for (let entry = this.dequeue(); entry; entry = this.dequeue() ) {
            entry.reject(error);
        }
    }
}

// LSP semantic-token type names the compiler emits via #SEMANTICTOKENS#.
// The order pins each name to its index; tokens in the encoded
// response refer to a type by that index. Keep in sync with
// SEMANTIC_TOKEN_CLASSIFIER.token_type in the compiler.
export const SEMANTIC_TOKEN_TYPES: string[] = [
    'namespace',
    'class',
    'interface',
    'struct',
    'enum',
    'enumMember',
    'typeParameter',
    'method',
    'function',
    'property',
    'variable',
    'parameter',
];

// LSP semantic-token modifier names. Encoded as a bitset (bit i set
// means the modifier at SEMANTIC_TOKEN_MODIFIERS[i] applies).
export const SEMANTIC_TOKEN_MODIFIERS: string[] = [
    'static',
];

export const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
    tokenTypes: SEMANTIC_TOKEN_TYPES,
    tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
};

const TOKEN_TYPE_INDEX = new Map<string, number>(
    SEMANTIC_TOKEN_TYPES.map((name, i) => [name, i])
);

const TOKEN_MODIFIER_BIT = new Map<string, number>(
    SEMANTIC_TOKEN_MODIFIERS.map((name, i) => [name, 1 << i])
);

// Convert the compiler's tab-separated rows
// (startLine, startCol, endLine, endCol, tokenType, modifiers — all
//  1-based coordinates, modifiers comma-separated, possibly empty)
// into the LSP delta-encoded `SemanticTokens.data` array:
//   [deltaLine, deltaStart, length, tokenType, tokenModifiers] × N.
// Rows whose tokenType isn't in the legend, or that span multiple
// lines, are skipped — LSP semantic tokens must be single-line.
export function parseSemanticTokens(lines: string[]): SemanticTokens {
    type Token = {
        line: number;
        startChar: number;
        length: number;
        typeIndex: number;
        modifierBits: number;
    };

    const tokens: Token[] = [];

    for (const line of lines) {
        if (!line) {
            continue;
        }

        const fields = line.split('\t');

        if (fields.length < 5) {
            continue;
        }

        const startLine = parseInt(fields[0], 10);
        const startCol = parseInt(fields[1], 10);
        const endLine = parseInt(fields[2], 10);
        const endCol = parseInt(fields[3], 10);
        const tokenType = fields[4];
        const modifiers = fields[5] ?? '';

        if (
            !Number.isFinite(startLine) ||
            !Number.isFinite(startCol) ||
            !Number.isFinite(endLine) ||
            !Number.isFinite(endCol)
        ) {
            continue;
        }

        if (startLine !== endLine) {
            continue;
        }

        const typeIndex = TOKEN_TYPE_INDEX.get(tokenType);

        if (typeIndex === undefined) {
            continue;
        }

        let modifierBits = 0;

        if (modifiers.length > 0) {
            for (const modifier of modifiers.split(',')) {
                const bit = TOKEN_MODIFIER_BIT.get(modifier);

                if (bit !== undefined) {
                    modifierBits |= bit;
                }
            }
        }

        const length = endCol - startCol;

        if (length <= 0) {
            continue;
        }

        tokens.push({
            line: startLine - 1,
            startChar: startCol - 1,
            length,
            typeIndex,
            modifierBits,
        });
    }

    // LSP requires tokens sorted by (line, startChar) for delta encoding.
    tokens.sort((a, b) => a.line - b.line || a.startChar - b.startChar);

    const data: number[] = [];

    let prevLine = 0;
    let prevStart = 0;

    for (const token of tokens) {
        const deltaLine = token.line - prevLine;
        const deltaStart = deltaLine === 0 ? token.startChar - prevStart : token.startChar;

        data.push(deltaLine, deltaStart, token.length, token.typeIndex, token.modifierBits);

        prevLine = token.line;
        prevStart = token.startChar;
    }

    return { data };
}

export class ResponseHandler {
    want_plaintext_hover: boolean;

    server_manager: ServerManager;
    connection: Connection;
    edit_queue: EditQueue;

    _hover_promise_queue: PromiseQueue<Hover>;
    _definition_promise_queue: PromiseQueue<Definition>;
    _declaration_promise_queue: PromiseQueue<Definition>;
    _completion_promise_queue: PromiseQueue<CompletionItem[]>;
    _signature_promise_queue: PromiseQueue<SignatureHelp>;
    _symbols_promise_queue: PromiseQueue<SymbolInformation[]>;
    _references_promise_queue: PromiseQueue<Location[]>;
    _implementation_promise_queue: PromiseQueue<Location[]>;
    _type_definition_promise_queue: PromiseQueue<Definition>;
    _rename_promise_queue: PromiseQueue<WorkspaceEdit>;
    _formatting_promise_queue: PromiseQueue<TextEdit[]>;
    _range_formatting_promise_queue: PromiseQueue<TextEdit[]>;
    _semantic_tokens_promise_queue: PromiseQueue<SemanticTokens>;

    // The full-document range to replace, one per pending format request,
    // paired FIFO with _formatting_promise_queue.
    _formatting_ranges: Range[] = [];

    constructor(
        connection: Connection,
        config_event_source: ConfigEventEmitter
    ) {
        this.connection = connection;

		config_event_source.onConfigAvailable((_workspace: string, config: GhulConfig) => {
            this.onConfigAvailable(_workspace, config);
        });

        this._hover_promise_queue = new PromiseQueue<Hover>("HOVER");
        this._definition_promise_queue = new PromiseQueue<Definition>("DEFINITION");
        this._declaration_promise_queue = new PromiseQueue<Definition>("DECLARATION");
        this._completion_promise_queue = new PromiseQueue<CompletionItem[]>("COMPLETION");
        this._signature_promise_queue = new PromiseQueue<SignatureHelp>("SIGNATURE");
        this._symbols_promise_queue = new PromiseQueue<SymbolInformation[]>("SYMBOLS");
        this._references_promise_queue = new PromiseQueue<Location[]>("REFERENCES");
        this._implementation_promise_queue = new PromiseQueue<Location[]>("IMPLEMENTATION");
        this._type_definition_promise_queue = new PromiseQueue<Definition>("TYPEDEFINITION");
        this._rename_promise_queue = new PromiseQueue<WorkspaceEdit>("RENAMEREQUEST");
        this._formatting_promise_queue = new PromiseQueue<TextEdit[]>("FORMAT");
        this._range_formatting_promise_queue = new PromiseQueue<TextEdit[]>("FORMATRANGE");
        this._semantic_tokens_promise_queue = new PromiseQueue<SemanticTokens>("SEMANTICTOKENS");
    }

    onConfigAvailable(_workspace: string, config: GhulConfig) {
        this.want_plaintext_hover = config.want_plaintext_hover;
    }

    resolveAllPendingPromises() {
        this._hover_promise_queue.resolveAll(null);
        this._definition_promise_queue.resolveAll([]);
        this._declaration_promise_queue.resolveAll([]);
        this._completion_promise_queue.resolveAll([]);
        this._signature_promise_queue.resolveAll(null);
        this._symbols_promise_queue.resolveAll([]);
        this._references_promise_queue.resolveAll([]);
        this._implementation_promise_queue.resolveAll([]);
        this._type_definition_promise_queue.resolveAll(null);
        this._rename_promise_queue.resolveAll(null);
        this._formatting_promise_queue.resolveAll([]);
        this._range_formatting_promise_queue.resolveAll([]);
        this._semantic_tokens_promise_queue.resolveAll({ data: [] });
        this._formatting_ranges = [];
    }

    rejectAllPendingPromises(message: string) {
        this._hover_promise_queue.rejectAll(message);
        this._definition_promise_queue.rejectAll(message);
        this._declaration_promise_queue.reject(message);
        this._completion_promise_queue.rejectAll(message);
        this._signature_promise_queue.rejectAll(message);
        this._symbols_promise_queue.rejectAll(message);
        this._references_promise_queue.rejectAll(message);
        this._implementation_promise_queue.rejectAll(message);
        this._type_definition_promise_queue.rejectAll(message);
        this._rename_promise_queue.reject(message);
        this._formatting_promise_queue.rejectAll(message);
        this._range_formatting_promise_queue.rejectAll(message);
        this._semantic_tokens_promise_queue.rejectAll(message);
        this._formatting_ranges = [];
    }

    setServerManager(server_manager: ServerManager) {
        if (this.server_manager == null) {
            this.server_manager = server_manager;
        } else {
            rejectAllAndThrow("replacing existing server manager in ResponseHandler");
        }
    }

    setEditQueue(edit_queue: EditQueue) {
        if (this.edit_queue == null) {
            this.edit_queue = edit_queue;
        } else {
            rejectAllAndThrow("replacing existing edit queue in ResponseHandler");
        }
    }    

    handleListen() {
        this.server_manager.startListening();
    }

    handleDiagnostics(lines: string[]) {
        for (let diagnostic of this.parseDiagnostics(lines)) {
            this.connection.sendDiagnostics( {uri: diagnostic[0], diagnostics: diagnostic[1]})
        }

        this.edit_queue.onDiagnosticsReceived();
    }

    handleFullCompileDone(lines: string[]) {
        let milliseconds: number = undefined;

        if (lines.length > 0) {
            milliseconds = parseFloat(lines[0]);
        }

        this.edit_queue.onFullCompileDone(milliseconds);
    }

    handlePartialCompileDone(lines: string[]) {
        let milliseconds: number = undefined;

        if (lines.length > 0) {
            milliseconds = parseFloat(lines[0]);
        }

        this.edit_queue.onPartialCompileDone(milliseconds);
    }

    handleHeapCheckDone() {
        this.edit_queue.onHeapCheckDone();
    }

    expectHover(): Promise<Hover> {
        return this._hover_promise_queue.enqueue();
    }

    handleHover(lines: string[]) {
        let {resolve} = this._hover_promise_queue.dequeueAlways();

        try {
            if (lines.length > 0 && lines[0] != null && lines[0].length > 0) {
                if (this.want_plaintext_hover) {
                    resolve({
                        contents: { kind: "plaintext", value: lines[0] }
                    });
                } else {
                    resolve({
                        contents: { language: "ghul", value: lines[0] }
                    });    
                }
            } else {
                resolve(null);
            }    
        } catch(e) {
            log("hover caught:", e);
            resolve(null);
        }
    }

    expectDefinition(): Promise<Definition> {
        return this._definition_promise_queue.enqueue();
    }

    handleDefinition(lines: string[]) {
        let {resolve} = this._definition_promise_queue.dequeueAlways();

        try {
            if (lines.length == 1) {
                resolve(this.parseLocation(lines[0]));
            } else {
                resolve(null);
            }    
        } catch(e) {
            log("definition caught:", e);
            resolve([]);
        }
    }

    expectDeclaration(): Promise<Definition> {
        return this._declaration_promise_queue.enqueue();
    }

    handleDeclaration(lines: string[]) {
        let {resolve} = this._declaration_promise_queue.dequeueAlways();

        try {
            let locations: Location[] = [];

            if (lines.length > 0) {
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    let location = this.parseLocation(line);

                    locations.push(location);
                }
            }

            resolve(
                locations
            );
        } catch(e) {
            log("declaration caught:", e);
            resolve([]);
        }
    }

    expectCompletion(): Promise<CompletionItem[]> {
        return this._completion_promise_queue.enqueue();
    }

    handleCompletion(lines: string[]) {
        let {resolve} = this._completion_promise_queue.dequeueAlways();

        try {
            let results: CompletionItem[] = [];

            for (let line of lines) {
                let fields = line.split('\t');

                if (fields.length >= 3) {
                    results.push({
                        label: fields[0],
                        kind:  <CompletionItemKind>parseInt(fields[1]),
                        detail: fields[2]
                    });
                }
            }
            
            resolve(results)
        } catch(e) {
            log("completion caught:", e);
            resolve([]);
        }
    }    

    expectSignature(): Promise<SignatureHelp> {
        return this._signature_promise_queue.enqueue();
    }

    handleSignature(lines: string[]) {
        let {resolve} = this._signature_promise_queue.dequeueAlways();

        try {
            let active_signature = 0;
            let active_parameter = 0;

            let signatures: SignatureInformation[] = [];

            if (lines.length > 0) {
                active_signature = parseInt(lines[0], 10);
                active_parameter = parseInt(lines[1], 10);

                if (active_signature < 0) {
                    active_signature = undefined;
                }

                for (let i = 2; i < lines.length; i++) {
                    let parameters: ParameterInformation[] = [];

                    let params_raw = lines[i].split('\t');

                    let signature_label = params_raw[0];

                    for (let j = 1; j < params_raw.length; j++) {
                        parameters.push({
                            label: params_raw[j]
                        });
                    }

                    signatures.push({
                        label: signature_label,
                        parameters: parameters,
                    });
                }
            }

            let result: SignatureHelp = {
                signatures: signatures,
                activeSignature: active_signature,
                activeParameter: active_parameter
            };

            resolve(
                result
            );
        } catch(e) {
            log("signature caught:", e);
            resolve({signatures: []})
        }
    }    

    expectSymbols(): Promise<SymbolInformation[]> {
        return this._symbols_promise_queue.enqueue();
    }

    handleSymbols(lines: string[]) {
        let {resolve} = this._symbols_promise_queue.dequeueAlways();

        try {
            let symbols: SymbolInformation[] = [];

            if (lines.length > 0) {
                let uri: string = "unknown";
                
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    let fields = line.split('\t');

                    if (fields.length == 1) {
                        uri = line;
                    } else {
                        let symbol: SymbolInformation = {
                            name: fields[0],
                            kind: <SymbolKind>parseInt(fields[1]),
                            location: {
                                uri: uri,
                                range: {
                                    start: {
                                        line: parseInt(fields[2]) - 1,
                                        character: parseInt(fields[3]) - 1
                                    },
                                    end: {
                                        line: parseInt(fields[4]) - 1,
                                        character: parseInt(fields[5]) - 1
                                    }
                                }
                            },
                            containerName: fields[6]
                        };

                        if (symbol.location.uri == "internal" || symbol.location.uri == "reflected") {
                            log("oops: unexpected internal/reflected uri in symbols response: " + symbol.location.uri);
                            continue;
                        }

                        if (symbol.location.range.start.line < 0 || symbol.location.range.start.character < 0 ||
                            symbol.location.range.end.line < 0 || symbol.location.range.end.character < 0)
                        {
                            log("oops: unexpected negative line/character in symbols response: " + JSON.stringify(symbol.location.range));
                            continue;
                        }    

                        symbols.push(symbol);
                    }
                }
            }

            resolve(
                symbols
            );
        } catch(e) {
            log("symbols caught:" + e);
            resolve([]);
        }
    }    
    
    expectReferences(): Promise<Location[]> {
        return this._references_promise_queue.enqueue();
    }

    handleReferences(lines: string[]) {
        let {resolve} = this._references_promise_queue.dequeueAlways();

        try {
            let locations: Location[] = [];

            if (lines.length > 0) {
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];

                    let location = this.parseLocation(line);

                    locations.push(location);
                }
            }

            resolve(
                locations
            );
        } catch(e) {
            log("references caught:", e);
            resolve([]);
        }
    }        

    expectImplementation(): Promise<Location[]> {
        return this._implementation_promise_queue.enqueue();
    }

    handleImplementation(lines: string[]) {
        let {resolve} = this._implementation_promise_queue.dequeueAlways();

        try {
            let locations: Location[] = [];

            if (lines.length > 0) {
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];

                    let location = this.parseLocation(line);

                    locations.push(location);
                }
            }

            resolve(
                locations
            );
        } catch(e) {
            log("implementation caught:", e);
            resolve([])
        }
    }

    expectTypeDefinition(): Promise<Definition> {
        return this._type_definition_promise_queue.enqueue();
    }

    handleTypeDefinition(lines: string[]) {
        let {resolve} = this._type_definition_promise_queue.dequeueAlways();

        try {
            if (lines.length == 1) {
                resolve(this.parseLocation(lines[0]));
            } else {
                resolve(null);
            }
        } catch(e) {
            log("type definition caught:", e);
            resolve(null);
        }
    }

    expectRenameRequest(): Promise<WorkspaceEdit> {
        return this._rename_promise_queue.enqueue();
    }

    handleRenameRequest(lines: string[]) {
        let {resolve} = this._rename_promise_queue.dequeueAlways();

        try {
            let changes: {
                [uri: string]: TextEdit[];
            } = {};

            if (lines.length > 0) {
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    let fields = line.split('\t');

                    let uri = fields[0];

                    let edits = changes[uri];

                    if (!edits) {
                        edits = [];
                        changes[uri] = edits;
                    }

                    let edit = {
                        range: {
                            start: {
                                line: parseInt(fields[1]) - 1,
                                character: parseInt(fields[2]) - 1
                            },
                            end: {
                                line: parseInt(fields[3]) - 1,
                                character: parseInt(fields[4])
                            }
                        },
                        newText: fields[5]
                    };

                    edits.push(edit)
                }
            }

            resolve(
                { changes }
            );
        } catch(e) {
            log("rename request: caught:" + e);
            resolve({});
        }
    }    

    expectDocumentFormatting(range: Range): Promise<TextEdit[]> {
        this._formatting_ranges.push(range);
        return this._formatting_promise_queue.enqueue();
    }

    handleDocumentFormatting(lines: string[]) {
        let {resolve} = this._formatting_promise_queue.dequeueAlways();
        let range = this._formatting_ranges.shift();

        try {
            // The compiler returns the whole reformatted document; the parser
            // has already stripped the FORMAT header and trailing terminator.
            // Replace the whole document in one edit. If the compiler could
            // not format (it echoes the buffer back unchanged), the edit is a
            // harmless no-op.
            let newText = lines.join('\n') + '\n';

            resolve([{ range, newText }]);
        } catch(e) {
            log("document formatting: caught:" + e);
            resolve([]);
        }
    }

    expectDocumentRangeFormatting(): Promise<TextEdit[]> {
        return this._range_formatting_promise_queue.enqueue();
    }

    handleDocumentRangeFormatting(lines: string[]) {
        let {resolve} = this._range_formatting_promise_queue.dequeueAlways();

        try {
            // First line is the tab-separated 1-based span the compiler chose
            // to format (start line, start column, end line, end column); the
            // rest is the replacement text. A zero start line means nothing
            // was formatted.
            let fields = (lines[0] ?? "").split('\t');

            let startLine = parseInt(fields[0]);

            if (!startLine) {
                resolve([]);
                return;
            }

            let edit = {
                range: {
                    start: { line: startLine - 1, character: parseInt(fields[1]) - 1 },
                    end: { line: parseInt(fields[2]) - 1, character: parseInt(fields[3]) - 1 }
                },
                newText: lines.slice(1).join('\n')
            };

            resolve([edit]);
        } catch(e) {
            log("document range formatting: caught:" + e);
            resolve([]);
        }
    }

    expectSemanticTokens(): Promise<SemanticTokens> {
        return this._semantic_tokens_promise_queue.enqueue();
    }

    handleSemanticTokens(lines: string[]) {
        let {resolve} = this._semantic_tokens_promise_queue.dequeueAlways();

        try {
            resolve(parseSemanticTokens(lines));
        } catch(e) {
            log("semantic tokens caught:" + e);
            resolve({ data: [] });
        }
    }

    handleRestart() {
        log("compiler requested restart");
        this.server_manager.noteRecycle();
        this.edit_queue.reset();
    }
    
    handleUnexpected() {
        this.server_manager.abort();
    }

    parseDiagnostics(lines: string[]) {
        let problems = new Map<string, Diagnostic[]>();

        for (var i = 0; i < lines.length; i++) {
            let line = lines[i];

            let fields = line.split('\t');

            if (fields.length == 0) {
                continue;
            }

            let uri = fields[0];

            if (uri == "internal" || uri == "reflected") {
                continue;
            }

            if (!uri.startsWith("file://")) {
                uri = "file://" + uri;
            }

            uri = normalizeFileUri(uri);

            if (!problems.has(uri)) {
                problems.set(uri, []);
            }

            if (fields.length != 7) {
                continue;
            }

            let problem = {
                severity: SeverityMapper.getSeverity(fields[5], "new"),
                range: {
                    start: { line: Number(fields[1]) - 1, character: Number(fields[2]) - 1 },
                    end: { line: Number(fields[3]) - 1, character: Number(fields[4]) - 1 }
                },
                message: fields[6],
                source: 'ghūl'
            }

            let list = problems.get(uri);

            list.push(problem);
        }

        return problems;
    }


    private parseLocation(line: string) {
        let fields = line.split('\t');

        let location: Location = {
            uri: fields[0],
            range: {
                start: {
                    line: parseInt(fields[1]) - 1,
                    character: parseInt(fields[2]) - 1
                },
                end: {
                    line: parseInt(fields[3]) - 1,
                    character: parseInt(fields[4])
                }
            }
        };

        return location;
    }
}

