import { EventEmitter } from 'events';
import { writeFileSync } from 'fs';
import { spawn } from 'child_process';

import { ServerManager, ServerState } from '../src/server-manager';
import { ServerEventEmitter } from '../src/server-event-emitter';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { EditQueue } from '../src/edit-queue';
import { ResponseParser } from '../src/response-parser';
import { ResponseHandler } from '../src/response-handler';
import { ExtensionState } from '../src/extension-state';
import { Watchdog } from '../src/watchdog';
import { GhulConfig } from '../src/ghul-config';

// jest.mock calls are hoisted above the imports so writeFileSync and spawn
// resolve to the mocks even when imported normally:
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    writeFileSync: jest.fn(),
}));

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    spawn: jest.fn(),
}));

function makeFakeChild(pid = 4242) {
    // start() wires .on('error'), .stdout.on, .stderr.on, .on('exit') — give
    // it an EventEmitter-shaped object whose streams are EventEmitters too.
    const child: any = new EventEmitter();
    child.pid = pid;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    return child;
}

describe('ServerManager (state helpers)', () => {
    let manager: ServerManager;
    let serverEvents: ServerEventEmitter;
    let configEvents: ConfigEventEmitter;

    beforeEach(() => {
        serverEvents = new ServerEventEmitter();
        configEvents = new ConfigEventEmitter();

        manager = new ServerManager(
            configEvents,
            serverEvents,
            {} as EditQueue,
            {} as ResponseParser,
        );
    });

    describe('startListening', () => {
        it('moves to Listening and emits listening event', () => {
            const handler = jest.fn();
            serverEvents.onListening(handler);

            manager.startListening();

            expect(manager.state()).toBe(ServerState.Listening);
            expect(handler).toHaveBeenCalled();
        });

        it('does nothing when the server is Blocked', () => {
            manager.server_state = ServerState.Blocked;
            const handler = jest.fn();
            serverEvents.onListening(handler);

            manager.startListening();

            expect(manager.state()).toBe(ServerState.Blocked);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('abort', () => {
        it('moves to Aborted and emits the abort event on the bus', () => {
            // The raw event name is 'aborted'; see server-event-emitter tests.
            const rawHandler = jest.fn();
            serverEvents.on('aborted', rawHandler);

            manager.abort();

            expect(manager.state()).toBe(ServerState.Aborted);
            expect(rawHandler).toHaveBeenCalledTimes(1);
        });

        it('does nothing when Blocked', () => {
            manager.server_state = ServerState.Blocked;
            const rawHandler = jest.fn();
            serverEvents.on('aborted', rawHandler);

            manager.abort();

            expect(manager.state()).toBe(ServerState.Blocked);
            expect(rawHandler).not.toHaveBeenCalled();
        });
    });

    describe('kill', () => {
        it('emits killing and aborts when child.kill() throws', () => {
            const killingHandler = jest.fn();
            const rawAbortHandler = jest.fn();
            serverEvents.onKilling(killingHandler);
            serverEvents.on('aborted', rawAbortHandler);

            // No this.child — child.kill() throws TypeError → catch → abort()
            manager.kill();

            expect(killingHandler).toHaveBeenCalled();
            expect(rawAbortHandler).toHaveBeenCalled();
            expect(manager.state()).toBe(ServerState.Aborted);
        });

        it('completes the happy path when child.kill() succeeds', () => {
            const killing = jest.fn();
            const killed = jest.fn();
            serverEvents.onKilling(killing);
            serverEvents.onKilled(killed);

            manager.child = { kill: jest.fn() } as any;

            manager.kill();

            expect(killing).toHaveBeenCalled();
            expect(killed).toHaveBeenCalled();
            expect(manager.expecting_exit).toBe(true);
            expect((manager.child!.kill as jest.Mock)).toHaveBeenCalled();
        });
    });

    describe('killQuiet', () => {
        it('is a no-op (covers it for parity)', () => {
            expect(() => manager.killQuiet()).not.toThrow();
        });
    });

    describe('start', () => {
        // start() is the bug-class adjacency for ghul-vsce#69: it writes
        // .analysis.rsp from this.ghul_config.arguments and then spawns the
        // compiler with @.analysis.rsp. If anything mis-shapes the rsp
        // contents (empty args, wrong quoting, missing -a flags), the
        // analyser falls back to its tiny default assembly list and
        // produces spurious diagnostics. Pin the contract here.

        const baseConfig: GhulConfig = {
            block: false,
            compiler: ['dotnet', 'tool', 'run', 'ghul-compiler'],
            source: ['./**/*.ghul'],
            arguments: ['-a', '/path/to/A.dll', '-a', '/path/to/B.dll', '-A'],
            want_plaintext_hover: false,
        };

        beforeEach(() => {
            (writeFileSync as jest.Mock).mockClear();
            (spawn as jest.Mock).mockClear().mockImplementation(() => makeFakeChild());
            manager.ghul_config = { ...baseConfig };

            // start()'s exit handler calls resolveAllPendingPromises, which
            // delegates to the ExtensionState singleton's response_handler.
            // Wire a minimal stub so the handler doesn't throw and obscure
            // the assertions we actually want to make:
            const state = ExtensionState.getInstance();
            state.watchdog = new Watchdog(10000);
            state.response_handler = {
                resolveAllPendingPromises: jest.fn(),
                rejectAllPendingPromises: jest.fn(),
            } as unknown as ResponseHandler;
        });

        afterEach(() => {
            // requester.test.ts hits the same hazard: leaving the watchdog
            // armed can fire after the test ends and crash the worker.
            ExtensionState.getInstance().watchdog.clearWatchdog();
        });

        it('writes .analysis.rsp with shell-quoted arguments', () => {
            manager.start();

            expect(writeFileSync).toHaveBeenCalledTimes(1);
            const [path, contents] = (writeFileSync as jest.Mock).mock.calls[0];
            expect(path).toBe('.analysis.rsp');
            // shell-quote joins with spaces; full argument list must round-trip:
            expect(contents).toBe('-a /path/to/A.dll -a /path/to/B.dll -A');
        });

        it('writes every -a flag into the rsp (regression guard for #69)', () => {
            // The fresh-checkout bug shipped an arguments array containing
            // just ['-A'] because .assemblies.json hadn't been generated yet.
            // Pin that the rsp content reflects whatever arguments contains —
            // server-manager itself does not invent or filter assemblies.
            manager.ghul_config = {
                ...baseConfig,
                arguments: ['-a', '/x.dll', '-a', '/y.dll', '-a', '/z.dll', '-A'],
            };
            manager.start();

            const [, contents] = (writeFileSync as jest.Mock).mock.calls[0];
            expect(contents).toContain('-a /x.dll');
            expect(contents).toContain('-a /y.dll');
            expect(contents).toContain('-a /z.dll');
            expect(contents.endsWith('-A')).toBe(true);
        });

        it('quotes arguments containing spaces correctly via shell-quote', () => {
            manager.ghul_config = {
                ...baseConfig,
                arguments: ['-a', '/path with spaces/A.dll', '-A'],
            };
            manager.start();

            const [, contents] = (writeFileSync as jest.Mock).mock.calls[0];
            // shell-quote escapes spaces — the exact escape form is shell-quote's
            // choice; just verify it round-trips back to the original tokens via
            // the inverse `parse` to keep the test agnostic of single-vs-backslash:
            const { parse } = require('shell-quote');
            expect(parse(contents)).toEqual(['-a', '/path with spaces/A.dll', '-A']);
        });

        it('spawns the compiler head with the rest of its args plus @.analysis.rsp', () => {
            manager.start();

            expect(spawn).toHaveBeenCalledTimes(1);
            const [head, args] = (spawn as jest.Mock).mock.calls[0];
            expect(head).toBe('dotnet');
            expect(args).toEqual(['tool', 'run', 'ghul-compiler', '@.analysis.rsp']);
        });

        it('emits starting then running, with the spawned child', () => {
            const startingHandler = jest.fn();
            const runningHandler = jest.fn();
            serverEvents.onStarting(startingHandler);
            serverEvents.onRunning(runningHandler);

            const child = makeFakeChild(9999);
            (spawn as jest.Mock).mockImplementationOnce(() => child);

            manager.start();

            expect(startingHandler).toHaveBeenCalled();
            expect(runningHandler).toHaveBeenCalledWith(child);
            // starting must fire before running (event ordering matters for
            // any consumer that resets state on 'starting'):
            expect(startingHandler.mock.invocationCallOrder[0])
                .toBeLessThan(runningHandler.mock.invocationCallOrder[0]);
        });

        it('moves to StartingUp state before spawning', () => {
            // start() sets state to StartingUp synchronously before
            // writeFileSync / spawn. If a future change defers state setting
            // past spawn, an exit during spawn could observe Cold state.
            manager.start();

            expect(manager.state()).toBe(ServerState.StartingUp);
        });

        it('honours block = true: no rsp write, no spawn, state Blocked', () => {
            manager.ghul_config = { ...baseConfig, block: true };

            manager.start();

            expect(writeFileSync).not.toHaveBeenCalled();
            expect(spawn).not.toHaveBeenCalled();
            expect(manager.state()).toBe(ServerState.Blocked);
        });

        it('kills an existing child before spawning a replacement', () => {
            const oldChild = makeFakeChild(1111);
            manager.child = oldChild;

            manager.start();

            expect(oldChild.kill).toHaveBeenCalledTimes(1);
            expect(manager.expecting_exit).toBe(true);
            // The new spawn still happened:
            expect(spawn).toHaveBeenCalledTimes(1);
        });

        it('child stdout chunks are forwarded to the response parser', () => {
            const handleChunkSpy = jest.fn();
            manager.response_parser = { handleChunk: handleChunkSpy } as unknown as ResponseParser;

            const child = makeFakeChild();
            (spawn as jest.Mock).mockImplementationOnce(() => child);

            manager.start();

            child.stdout.emit('data', Buffer.from('LISTEN\n\f'));

            expect(handleChunkSpy).toHaveBeenCalledWith('LISTEN\n\f');
        });

        it('on unexpected exit, resets edit queue and respawns', () => {
            const resetSpy = jest.fn();
            manager.edit_queue = { reset: resetSpy } as unknown as EditQueue;

            const firstChild = makeFakeChild(1001);
            const secondChild = makeFakeChild(1002);
            (spawn as jest.Mock)
                .mockImplementationOnce(() => firstChild)
                .mockImplementationOnce(() => secondChild);

            manager.start();
            // Simulate the compiler crashing without the manager having
            // asked it to exit:
            manager.expecting_exit = false;
            firstChild.emit('exit', 1, null);

            expect(resetSpy).toHaveBeenCalled();
            expect(spawn).toHaveBeenCalledTimes(2);
        });

        it('on expected exit, does not respawn', () => {
            const resetSpy = jest.fn();
            manager.edit_queue = { reset: resetSpy } as unknown as EditQueue;

            const child = makeFakeChild(2002);
            (spawn as jest.Mock).mockImplementationOnce(() => child);

            manager.start();
            manager.expecting_exit = true;
            child.emit('exit', 0, null);

            expect(resetSpy).not.toHaveBeenCalled();
            expect(spawn).toHaveBeenCalledTimes(1);
            // expecting_exit must be cleared so the next manual kill works:
            expect(manager.expecting_exit).toBe(false);
        });
    });
});
