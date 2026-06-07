import {
    Connection,
    CompletionItem,
    CompletionItemKind,
    Definition,
    InsertTextFormat,
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

import { normalizeFileUri } from './normalize-file-uri';

import { SeverityMapper } from './severity-map';

import { ServerManager } from './server-manager';

import { EditQueue } from './edit-queue';
import { ConfigEventEmitter } from './config-event-emitter';
import { GhulConfig } from './ghul-config';

// ---- wire DTOs (one JSON object per line; snake_case fields) -------------
//
// These mirror the compiler-side DTOs in src/analysis/protocol/responses.ghul.
// Coordinates are 1-based on the wire; the handlers convert to LSP's 0-based.

interface DiagnosticDto {
    path: string;
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    severity: number;
    message: string;
}

interface LocationDto {
    file: string;
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
}

interface SemanticTokenDto {
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    token_type: string;
    modifiers: string;
}

interface CompletionItemDto {
    name: string;
    kind: number;
    description: string;
    insert_text?: string;
}

interface SignatureDto {
    label: string;
    parameters: string[];
}

interface SymbolDto {
    search_description: string;
    kind: number;
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    qualifier: string;
}

interface SymbolFileDto {
    path: string;
    symbols: SymbolDto[];
}

interface RenameEditDto {
    file: string;
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    new_name: string;
}

interface DiagnosticsResponse {
    kind: "diagnostics";
    diagnostics: DiagnosticDto[];
    checked_paths: string[];
    phase: string;
    elapsed_ms: number;
    compile_needed: boolean;
}

interface HoverResponse {
    kind: "hover";
    description: string | null;
}

interface SemanticTokensResponse {
    kind: "semantic_tokens";
    tokens: SemanticTokenDto[];
}

interface LocationsResponse {
    locations: LocationDto[];
}

interface CompletionResponse {
    kind: "completion";
    items: CompletionItemDto[];
}

interface SignatureResponse {
    kind: "signature";
    best_signature_index: number;
    current_parameter_index: number;
    signatures: SignatureDto[];
}

interface SymbolsResponse {
    kind: "symbols";
    files: SymbolFileDto[];
}

interface RenameResponse {
    kind: "rename";
    edits: RenameEditDto[];
}

interface FormatResponse {
    kind: "format";
    text: string;
}

interface FormatRangeResponse {
    kind: "format_range";
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
    text: string;
}

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

// LSP semantic-token type names the compiler emits via semantic_tokens.
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
    'readonly',
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

// Convert the compiler's semantic-token DTOs
// (start_line, start_column, end_line, end_column, token_type, modifiers —
//  all 1-based coordinates, modifiers comma-separated, possibly empty)
// into the LSP delta-encoded `SemanticTokens.data` array:
//   [deltaLine, deltaStart, length, tokenType, tokenModifiers] × N.
// Tokens whose tokenType isn't in the legend, or that span multiple
// lines, are skipped — LSP semantic tokens must be single-line.
export function parseSemanticTokens(dtos: SemanticTokenDto[]): SemanticTokens {
    type Token = {
        line: number;
        startChar: number;
        length: number;
        typeIndex: number;
        modifierBits: number;
    };

    const tokens: Token[] = [];

    for (const dto of dtos ?? []) {
        if (!dto) {
            continue;
        }

        const startLine = dto.start_line;
        const startCol = dto.start_column;
        const endLine = dto.end_line;
        const endCol = dto.end_column;
        const tokenType = dto.token_type;
        const modifiers = dto.modifiers ?? '';

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

        // Compiler emits end_column as 1-based INCLUSIVE — the column
        // of the LAST character — so a single-char identifier reports
        // start == end. Convert to character count by adding 1.
        const length = endCol - startCol + 1;

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
    incremental_analysis_requested: boolean = false;

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
        this.incremental_analysis_requested = config.incremental_analysis;
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

    // Log, reject every pending promise queue, and throw. The combination
    // unwinds the request currently in flight AND tells every awaiter the
    // run is over, instead of stalling them on a never-resolved promise.
    rejectAllAndThrow(message: string): never {
        log(message);
        this.rejectAllPendingPromises(message);
        throw message;
    }

    setServerManager(server_manager: ServerManager) {
        if (this.server_manager == null) {
            this.server_manager = server_manager;
        } else {
            this.rejectAllAndThrow("replacing existing server manager in ResponseHandler");
        }
    }

    setEditQueue(edit_queue: EditQueue) {
        if (this.edit_queue == null) {
            this.edit_queue = edit_queue;
        } else {
            this.rejectAllAndThrow("replacing existing edit queue in ResponseHandler");
        }
    }

    handleListen(message?: { capabilities?: string[] }) {
        let capabilities = message?.capabilities ?? [];

        if (
            this.incremental_analysis_requested &&
            !capabilities.includes("incremental-analysis")
        ) {
            log(
                "ghul.json sets incremental_analysis but the spawned " +
                "compiler does not advertise it — running with the " +
                "feature disabled. Upgrade ghul.compiler to use it."
            );
        }

        this.server_manager.startListening();
    }

    // A single `diagnostics` response now answers EDIT (phase "partial"),
    // COMPILE (phase "full"), and the unsolicited pre-query recompile
    // (phase "query"). It carries the squiggle payload AND the edit-queue
    // timing that the old PARTIAL DONE / FULL DONE frames carried, so it both
    // applies diagnostics and drives the edit-queue state machine — except for
    // phase "query", which (like the old query-miss DIAGNOSTICS frame that had
    // no following DONE) must not advance the state machine.
    handleDiagnostics(response: DiagnosticsResponse) {
        for (let [uri, diagnostics] of this.parseDiagnostics(response)) {
            this.connection.sendDiagnostics({ uri, diagnostics });
        }

        this.edit_queue.onDiagnosticsReceived();

        let milliseconds: number = undefined;

        if (response.elapsed_ms != null) {
            milliseconds = response.elapsed_ms;
        }

        if (response.phase == "partial") {
            this.edit_queue.onPartialCompileDone(milliseconds);
        } else if (response.phase == "full") {
            this.edit_queue.onFullCompileDone(milliseconds);
        }
        // phase == "query": apply diagnostics only; do not drive the state machine.
    }

    handleHeapCheckDone() {
        this.edit_queue.onHeapCheckDone();
    }

    expectHover(): Promise<Hover> {
        return this._hover_promise_queue.enqueue();
    }

    handleHover(response: HoverResponse) {
        let {resolve} = this._hover_promise_queue.dequeueAlways();

        try {
            let description = response.description;

            if (description != null && description.length > 0) {
                if (this.want_plaintext_hover) {
                    resolve({
                        contents: { kind: "plaintext", value: description }
                    });
                } else {
                    resolve({
                        contents: { language: "ghul", value: description }
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

    handleDefinition(response: LocationsResponse) {
        let {resolve} = this._definition_promise_queue.dequeueAlways();

        try {
            let locations = this.parseLocations(response);

            if (locations.length == 1) {
                resolve(locations[0]);
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

    handleDeclaration(response: LocationsResponse) {
        let {resolve} = this._declaration_promise_queue.dequeueAlways();

        try {
            resolve(this.parseLocations(response));
        } catch(e) {
            log("declaration caught:", e);
            resolve([]);
        }
    }

    expectCompletion(): Promise<CompletionItem[]> {
        return this._completion_promise_queue.enqueue();
    }

    handleCompletion(response: CompletionResponse) {
        let {resolve} = this._completion_promise_queue.dequeueAlways();

        try {
            let results: CompletionItem[] = [];

            for (let item of response.items ?? []) {
                let completion: CompletionItem = {
                    label: item.name,
                    kind: <CompletionItemKind>item.kind,
                    detail: item.description
                };

                if (item.insert_text) {
                    completion.insertText = item.insert_text;
                    completion.insertTextFormat = InsertTextFormat.Snippet;
                }

                results.push(completion);
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

    handleSignature(response: SignatureResponse) {
        let {resolve} = this._signature_promise_queue.dequeueAlways();

        try {
            let active_signature = response.best_signature_index;
            let active_parameter = response.current_parameter_index;

            if (active_signature < 0) {
                active_signature = undefined;
            }

            let signatures: SignatureInformation[] = [];

            for (let signature of response.signatures ?? []) {
                let parameters: ParameterInformation[] = [];

                for (let parameter of signature.parameters ?? []) {
                    parameters.push({
                        label: parameter
                    });
                }

                signatures.push({
                    label: signature.label,
                    parameters: parameters,
                });
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

    handleSymbols(response: SymbolsResponse) {
        let {resolve} = this._symbols_promise_queue.dequeueAlways();

        try {
            let symbols: SymbolInformation[] = [];

            for (let file of response.files ?? []) {
                let uri = file.path;

                for (let dto of file.symbols ?? []) {
                    let symbol: SymbolInformation = {
                        name: dto.search_description,
                        kind: <SymbolKind>dto.kind,
                        location: {
                            uri: uri,
                            range: {
                                start: {
                                    line: dto.start_line - 1,
                                    character: dto.start_column - 1
                                },
                                end: {
                                    line: dto.end_line - 1,
                                    character: dto.end_column - 1
                                }
                            }
                        },
                        containerName: dto.qualifier
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

    handleReferences(response: LocationsResponse) {
        let {resolve} = this._references_promise_queue.dequeueAlways();

        try {
            resolve(this.parseLocations(response));
        } catch(e) {
            log("references caught:", e);
            resolve([]);
        }
    }

    expectImplementation(): Promise<Location[]> {
        return this._implementation_promise_queue.enqueue();
    }

    handleImplementation(response: LocationsResponse) {
        let {resolve} = this._implementation_promise_queue.dequeueAlways();

        try {
            resolve(this.parseLocations(response));
        } catch(e) {
            log("implementation caught:", e);
            resolve([])
        }
    }

    expectTypeDefinition(): Promise<Definition> {
        return this._type_definition_promise_queue.enqueue();
    }

    handleTypeDefinition(response: LocationsResponse) {
        let {resolve} = this._type_definition_promise_queue.dequeueAlways();

        try {
            let locations = this.parseLocations(response);

            if (locations.length == 1) {
                resolve(locations[0]);
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

    handleRenameRequest(response: RenameResponse) {
        let {resolve} = this._rename_promise_queue.dequeueAlways();

        try {
            let changes: {
                [uri: string]: TextEdit[];
            } = {};

            for (let dto of response.edits ?? []) {
                let uri = dto.file;

                let edits = changes[uri];

                if (!edits) {
                    edits = [];
                    changes[uri] = edits;
                }

                // end_column is used without the -1 the other coordinates get,
                // matching the old text protocol's rename end-column handling.
                let edit = {
                    range: {
                        start: {
                            line: dto.start_line - 1,
                            character: dto.start_column - 1
                        },
                        end: {
                            line: dto.end_line - 1,
                            character: dto.end_column
                        }
                    },
                    newText: dto.new_name
                };

                edits.push(edit)
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

    handleDocumentFormatting(response: FormatResponse) {
        let {resolve} = this._formatting_promise_queue.dequeueAlways();
        let range = this._formatting_ranges.shift();

        try {
            // The compiler returns the whole reformatted document. Replace the
            // whole document in one edit. If the compiler could not format (it
            // echoes the buffer back unchanged), the edit is a harmless no-op.
            let newText = response.text;

            resolve([{ range, newText }]);
        } catch(e) {
            log("document formatting: caught:" + e);
            resolve([]);
        }
    }

    expectDocumentRangeFormatting(): Promise<TextEdit[]> {
        return this._range_formatting_promise_queue.enqueue();
    }

    handleDocumentRangeFormatting(response: FormatRangeResponse) {
        let {resolve} = this._range_formatting_promise_queue.dequeueAlways();

        try {
            // The span is the 1-based range the compiler chose to format. A
            // zero start line (an all-zero span) means nothing was formatted.
            let startLine = response.start_line;

            if (!startLine) {
                resolve([]);
                return;
            }

            let edit = {
                range: {
                    start: { line: startLine - 1, character: response.start_column - 1 },
                    end: { line: response.end_line - 1, character: response.end_column - 1 }
                },
                newText: response.text
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

    handleSemanticTokens(response: SemanticTokensResponse) {
        let {resolve} = this._semantic_tokens_promise_queue.dequeueAlways();

        try {
            resolve(parseSemanticTokens(response.tokens));
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

    // Build a per-URI diagnostics map. Every path the compile checked
    // (checked_paths) gets an entry — empty unless it carries diagnostics —
    // so the client clears stale squiggles for clean files and refreshes the
    // rest. This replaces the old text protocol's bare-path-line "clear
    // errors" signal.
    parseDiagnostics(response: DiagnosticsResponse): Map<string, Diagnostic[]> {
        let problems = new Map<string, Diagnostic[]>();

        let toUri = (path: string): string | null => {
            if (path == "internal" || path == "reflected") {
                return null;
            }

            let uri = path;

            if (!uri.startsWith("file://")) {
                uri = "file://" + uri;
            }

            return normalizeFileUri(uri);
        };

        for (let path of response.checked_paths ?? []) {
            let uri = toUri(path);

            if (uri != null && !problems.has(uri)) {
                problems.set(uri, []);
            }
        }

        for (let dto of response.diagnostics ?? []) {
            let uri = toUri(dto.path);

            if (uri == null) {
                continue;
            }

            if (!problems.has(uri)) {
                problems.set(uri, []);
            }

            let problem: Diagnostic = {
                severity: SeverityMapper.getSeverity(dto.severity, "new"),
                range: {
                    start: { line: dto.start_line - 1, character: dto.start_column - 1 },
                    end: { line: dto.end_line - 1, character: dto.end_column - 1 }
                },
                message: dto.message,
                source: 'ghūl'
            };

            problems.get(uri).push(problem);
        }

        return problems;
    }

    private parseLocations(response: LocationsResponse): Location[] {
        let locations: Location[] = [];

        for (let dto of response.locations ?? []) {
            locations.push({
                uri: dto.file,
                range: {
                    start: {
                        line: dto.start_line - 1,
                        character: dto.start_column - 1
                    },
                    end: {
                        line: dto.end_line - 1,
                        // end_column without -1, matching the old text
                        // protocol's parseLocation handling.
                        character: dto.end_column
                    }
                }
            });
        }

        return locations;
    }
}
