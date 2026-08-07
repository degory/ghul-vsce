import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

// A minimal, dependency-free LSP client over stdio: just enough
// Content-Length framing and request/notification bookkeeping to drive the
// real server.js the way VS Code's language client does, without pulling in
// VS Code itself. Used only by the real-process integration tier — every
// other test in this repo mocks child_process and never needs this.
export class LspClient {
    private child: ChildProcessWithoutNullStreams;
    private buffer = Buffer.alloc(0);
    private nextId = 1;
    private pending = new Map<number, (message: any) => void>();

    readonly progressNotifications: any[] = [];
    readonly logMessages: string[] = [];
    readonly stderr: string[] = [];

    // vscode-languageclient does not wire up its window/workDoneProgress/create
    // handler the instant it receives the initialize response — that happens
    // as part of its own (asynchronous) feature-initialization work afterwards.
    // Modelled here with a one-tick delay after the response is dispatched, so
    // a server that sends this request too early (the #152/#154 race this
    // fixes) gets the same "Unhandled method" failure a real client would give
    // it, rather than this harness silently tolerating any message ordering.
    private initializeRequestId: number | null = null;
    private readyForServerRequests = false;

    constructor(serverPath: string, cwd: string) {
        this.child = spawn('node', [serverPath, '--stdio'], { cwd });
        this.child.stdout.on('data', chunk => this.onData(chunk));
        this.child.stderr.on('data', chunk => this.stderr.push(chunk.toString('utf8')));
    }

    private onData(chunk: Buffer) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                return;
            }

            const header = this.buffer.slice(0, headerEnd).toString('utf8');
            const match = /Content-Length: (\d+)/.exec(header);
            if (!match) {
                return;
            }

            const length = parseInt(match[1], 10);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length) {
                return;
            }

            const body = this.buffer.slice(bodyStart, bodyStart + length).toString('utf8');
            this.buffer = this.buffer.slice(bodyStart + length);

            this.dispatch(JSON.parse(body));
        }
    }

    private dispatch(message: any) {
        // A message carrying a method is a request or a notification, never a
        // response — and the two id sequences are independent, so the server's
        // request ids collide with this client's own as a matter of course.
        // Matching on id first mistakes an inbound request for the response to
        // an outbound one of the same number, which resolves the wrong promise
        // and leaves the server's request unanswered forever.
        if (message.method === undefined && message.id !== undefined && this.pending.has(message.id)) {
            const resolve = this.pending.get(message.id)!;
            this.pending.delete(message.id);
            resolve(message);

            if (message.id === this.initializeRequestId) {
                setImmediate(() => { this.readyForServerRequests = true; });
            }
            return;
        }

        if (message.method === '$/progress') {
            this.progressNotifications.push(message.params);
        } else if (message.method === 'window/logMessage') {
            this.logMessages.push(message.params.message);
        } else if (message.method === 'window/workDoneProgress/create') {
            if (this.readyForServerRequests) {
                // The server asks permission to create a progress token; a
                // real client always grants it once it's ready to.
                this.send({ jsonrpc: '2.0', id: message.id, result: null });
            } else {
                // What a real client's own JSON-RPC layer sends back for a
                // request it has no handler registered for yet — matches the
                // "Unhandled method window/workDoneProgress/create" this
                // fixture pins the server against sending.
                this.send({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32601, message: `Unhandled method ${message.method}` },
                });
            }
        }
        // Other server->client requests (client/registerCapability, ...) are
        // acknowledged implicitly by not answering — the real server does
        // not block waiting on them for the behaviour under test here.
    }

    private send(message: object) {
        const json = JSON.stringify(message);
        this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
    }

    request<T = any>(method: string, params: any): Promise<T> {
        const id = this.nextId++;
        if (method === 'initialize') {
            this.initializeRequestId = id;
        }
        this.send({ jsonrpc: '2.0', id, method, params });
        return new Promise(resolve => this.pending.set(id, (message) => resolve(message.result)));
    }

    notify(method: string, params: any) {
        this.send({ jsonrpc: '2.0', method, params });
    }

    // Proper LSP shutdown, not just killing the client's own process: the
    // server's onShutdown handler kills its own compiler child, and skipping
    // this leaves an orphaned real ghul-compiler process behind every test.
    // Bounded — a wedged or already-dead server would otherwise leave
    // `shutdown` unanswered forever, and with it the compiler child too,
    // which is exactly the failure this method exists to avoid.
    async dispose() {
        try {
            await Promise.race([
                this.request('shutdown', null),
                new Promise<void>(resolve => setTimeout(resolve, 5000).unref()),
            ]);
            this.notify('exit', {});
        } finally {
            this.child.kill();
        }
    }
}
