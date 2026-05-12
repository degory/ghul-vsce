import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { GhulAnalyser } from '../src/ghul-analyser';
import { ConfigEventEmitter } from '../src/config-event-emitter';
import { ServerEventEmitter } from '../src/server-event-emitter';
import { EditQueue } from '../src/edit-queue';
import { GhulConfig } from '../src/ghul-config';

class RecordingEditQueue {
    started: Array<{ uri: string; source: string }[]> = [];
    start(documents: { uri: string; source: string }[]) {
        this.started.push(documents);
    }
}

describe('GhulAnalyser', () => {
    let configEvents: ConfigEventEmitter;
    let serverEvents: ServerEventEmitter;
    let editQueue: RecordingEditQueue;
    let workspace: string;

    beforeEach(() => {
        configEvents = new ConfigEventEmitter();
        serverEvents = new ServerEventEmitter();
        editQueue = new RecordingEditQueue();
        workspace = mkdtempSync(join(tmpdir(), 'ghul-vsce-analyser-'));
    });

    afterEach(() => {
        try { rmSync(workspace, { recursive: true, force: true }); } catch { /* swallow */ }
    });

    it('captures config when configAvailable fires', () => {
        const analyser = new GhulAnalyser(
            editQueue as unknown as EditQueue,
            configEvents,
            serverEvents,
        );

        const config: GhulConfig = {
            block: false,
            compiler: ['c'],
            source: ['x'],
            arguments: [],
            want_plaintext_hover: false,
        };
        configEvents.configAvailable(workspace, config);

        expect(analyser.workspace_root).toBe(workspace);
        expect(analyser.ghul_config).toBe(config);
    });

    it('starts edit queue with discovered .ghul files when listening fires', () => {
        // Lay down a few .ghul files plus a distractor:
        writeFileSync(join(workspace, 'a.ghul'), 'class A is {}');
        mkdirSync(join(workspace, 'sub'));
        writeFileSync(join(workspace, 'sub', 'b.ghul'), 'class B is {}');
        writeFileSync(join(workspace, 'sub', 'c.txt'), 'not ghul');

        // The analyser's only role here is to wire its listeners during
        // construction — we then drive it via the event emitters.
        new GhulAnalyser(
            editQueue as unknown as EditQueue,
            configEvents,
            serverEvents,
        );

        configEvents.configAvailable(workspace, {
            block: false,
            compiler: ['c'],
            source: [`${workspace}/**/*.ghul`],
            arguments: [],
            want_plaintext_hover: false,
        });

        serverEvents.listening();

        expect(editQueue.started).toHaveLength(1);
        const uris = editQueue.started[0].map(d => d.uri).sort();
        expect(uris).toHaveLength(2);
        expect(uris[0]).toMatch(/a\.ghul$/);
        expect(uris[1]).toMatch(/b\.ghul$/);
        // Sources should be the file contents:
        expect(editQueue.started[0].find(d => d.uri.endsWith('a.ghul'))!.source).toBe('class A is {}');
    });

    it('starts edit queue with an empty document list when no source files match', () => {
        new GhulAnalyser(
            editQueue as unknown as EditQueue,
            configEvents,
            serverEvents,
        );

        configEvents.configAvailable(workspace, {
            block: false,
            compiler: ['c'],
            source: [`${workspace}/no-matches/**/*.ghul`],
            arguments: [],
            want_plaintext_hover: false,
        });

        serverEvents.listening();

        expect(editQueue.started).toEqual([[]]);
    });
});
