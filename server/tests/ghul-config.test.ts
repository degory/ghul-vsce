import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getGhulConfig } from '../src/ghul-config';

// Real fs is used here intentionally: per workspace convention, prefer real
// collaborators over mocks. We carve out a tmpdir per test, write fixture
// files, and assert against the parsed result.

function makeWorkspace(): string {
    return mkdtempSync(join(tmpdir(), 'ghul-vsce-cfg-'));
}

function writeJson(workspace: string, name: string, value: unknown) {
    writeFileSync(join(workspace, name), JSON.stringify(value));
}

describe('getGhulConfig', () => {
    let workspaces: string[];

    beforeEach(() => {
        workspaces = [];
    });

    afterEach(() => {
        for (const w of workspaces) {
            try { rmSync(w, { recursive: true, force: true }); } catch { /* swallow */ }
        }
    });

    function ws(): string {
        const w = makeWorkspace();
        workspaces.push(w);
        return w;
    }

    it('returns sane defaults for an empty workspace (no ghul.json, no project, no tools)', () => {
        const workspace = ws();
        const cfg = getGhulConfig(workspace);

        expect(cfg.block).toBe(false);
        expect(cfg.source).toEqual(['./**/*.ghul']);
        expect(cfg.want_plaintext_hover).toBe(false);
        // -A is always appended:
        expect(cfg.arguments).toContain('-A');
    });

    it('respects block = true when .block-compiler exists', () => {
        const workspace = ws();
        writeFileSync(join(workspace, '.block-compiler'), '');

        const cfg = getGhulConfig(workspace);
        expect(cfg.block).toBe(true);
    });

    it('uses compiler array from ghul.json verbatim', () => {
        const workspace = ws();
        writeJson(workspace, 'ghul.json', {
            compiler: ['my-compiler', '--flag'],
            source: ['src'],
        });

        const cfg = getGhulConfig(workspace);
        expect(cfg.compiler).toEqual(['my-compiler', '--flag']);
    });

    it('parses compiler string from ghul.json via shell-quote', () => {
        const workspace = ws();
        writeJson(workspace, 'ghul.json', {
            compiler: 'dotnet ghul-compiler --foo "bar baz"',
            source: ['src'],
        });

        const cfg = getGhulConfig(workspace);
        expect(cfg.compiler).toEqual(['dotnet', 'ghul-compiler', '--foo', 'bar baz']);
    });

    it('parses other_flags string into argument tokens', () => {
        const workspace = ws();
        writeJson(workspace, 'ghul.json', {
            compiler: ['c'],
            source: ['src'],
            other_flags: '--flag-one --flag-two=value',
        });

        const cfg = getGhulConfig(workspace);
        // -A is appended last; other_flags come before:
        expect(cfg.arguments).toEqual(['--flag-one', '--flag-two=value', '-A']);
    });

    it('expands directory-only source entries into glob patterns when a .ghulproj is present', () => {
        // The expansion path only fires when ghul.json gives source and a
        // single .ghulproj is also discoverable. Pin that combined behaviour
        // so a future refactor surfaces if it diverges:
        const workspace = ws();
        writeJson(workspace, 'ghul.json', {
            compiler: ['c'],
            source: ['src', 'lib/dotnet'],
        });
        writeFileSync(
            join(workspace, 'test.ghulproj'),
            `<?xml version="1.0"?><Project Sdk="Ghul.Sdk"><PropertyGroup/></Project>`
        );

        const cfg = getGhulConfig(workspace);
        expect(cfg.source).toEqual(['src/**/*.ghul', 'lib/dotnet/**/*.ghul']);
    });

    it('leaves source entries unchanged when no .ghulproj is present', () => {
        // Pin observed behaviour: without a .ghulproj, ghul.json source entries
        // are NOT expanded. This is probably surprising — flagged for review.
        const workspace = ws();
        writeJson(workspace, 'ghul.json', {
            compiler: ['c'],
            source: ['src', 'lib/dotnet'],
        });

        const cfg = getGhulConfig(workspace);
        expect(cfg.source).toEqual(['src', 'lib/dotnet']);
    });

    it('passes want_plaintext_hover through from ghul.json', () => {
        const workspace = ws();
        writeJson(workspace, 'ghul.json', {
            compiler: ['c'],
            want_plaintext_hover: true,
        });

        const cfg = getGhulConfig(workspace);
        expect(cfg.want_plaintext_hover).toBe(true);
    });

    it('strips a UTF-8 BOM from ghul.json', () => {
        const workspace = ws();
        writeFileSync(
            join(workspace, 'ghul.json'),
            '﻿' + JSON.stringify({ compiler: ['c'], source: ['src'] })
        );

        const cfg = getGhulConfig(workspace);
        expect(cfg.compiler).toEqual(['c']);
    });

    it('reads compiler from .config/dotnet-tools.json when no other source has set it', () => {
        const workspace = ws();
        mkdirSync(join(workspace, '.config'));
        writeJson(workspace, '.config/dotnet-tools.json', {
            version: 1,
            isRoot: true,
            tools: {
                'ghul.compiler': {
                    version: '0.6.30',
                    commands: ['ghul-compiler'],
                },
            },
        });

        const cfg = getGhulConfig(workspace);
        expect(cfg.compiler).toEqual(['dotnet', 'tool', 'run', 'ghul-compiler']);
    });

    it('prefers ghul.json compiler over the tool manifest', () => {
        const workspace = ws();
        mkdirSync(join(workspace, '.config'));
        writeJson(workspace, '.config/dotnet-tools.json', {
            version: 1,
            isRoot: true,
            tools: { 'ghul.compiler': { version: '0.6.30', commands: ['ghul-compiler'] } },
        });
        writeJson(workspace, 'ghul.json', { compiler: ['explicit-compiler'] });

        const cfg = getGhulConfig(workspace);
        expect(cfg.compiler).toEqual(['explicit-compiler']);
    });

    it('appends -a entries from .assemblies.json', () => {
        const workspace = ws();
        writeJson(workspace, 'ghul.json', { compiler: ['c'], source: ['src'] });
        writeJson(workspace, '.assemblies.json', {
            assemblies: ['/path/to/A.dll', '/path/to/B.dll'],
        });

        const cfg = getGhulConfig(workspace);
        expect(cfg.arguments).toEqual([
            '-a', '/path/to/A.dll',
            '-a', '/path/to/B.dll',
            '-A',
        ]);
    });

    it('produces just ["-A"] when no .assemblies.json is present (bug-trigger for #69)', () => {
        // On a fresh checkout .assemblies.json does not yet exist; if
        // getGhulConfig runs before generateAssembliesJson, this is the
        // state .analysis.rsp gets serialised from. server-manager then
        // spawns the analyser with no -a flags and it falls back to a
        // five-assembly default list. Pin the shape so a future change
        // does not silently start fabricating fake `-a` entries (or
        // dropping `-A` from the empty case).
        const workspace = ws();
        writeJson(workspace, 'ghul.json', { compiler: ['c'], source: ['src'] });
        // No .assemblies.json on disk.

        const cfg = getGhulConfig(workspace);
        expect(cfg.arguments).toEqual(['-A']);
    });

    it('reads compiler and sources from a .ghulproj when ghul.json is silent', () => {
        const workspace = ws();
        const proj = `<?xml version="1.0"?>
<Project Sdk="Ghul.Sdk">
    <PropertyGroup>
        <GhulCompiler>ghul-compiler-from-proj --flag</GhulCompiler>
    </PropertyGroup>
    <ItemGroup>
        <GhulSources Include="src/**/*.ghul" />
    </ItemGroup>
</Project>`;
        writeFileSync(join(workspace, 'test.ghulproj'), proj);

        const cfg = getGhulConfig(workspace);
        expect(cfg.compiler).toEqual(['ghul-compiler-from-proj', '--flag']);
        expect(cfg.source).toEqual(['src/**/*.ghul']);
    });

    it('forwards unconditioned <GhulOptions> additively and skips Condition-guarded ones', () => {
        const workspace = ws();
        const proj = `<?xml version="1.0"?>
<Project Sdk="Ghul.Sdk">
    <PropertyGroup>
        <GhulCompiler>ghul-compiler --underscore-access legacy</GhulCompiler>
    </PropertyGroup>
    <ItemGroup>
        <GhulSources Include="src/**/*.ghul" />
        <GhulOptions Include="--warn-as-hint presence-test-non-optional" />
        <GhulOptions Include="--define release" Condition="'$(CI)' != ''" />
    </ItemGroup>
</Project>`;
        writeFileSync(join(workspace, 'test.ghulproj'), proj);

        const cfg = getGhulConfig(workspace);
        // <GhulCompiler> flags stay on `compiler`; the unconditioned
        // <GhulOptions> land additively on `arguments` (ahead of -A); the
        // Condition-guarded --define release is skipped.
        expect(cfg.compiler).toEqual(['ghul-compiler', '--underscore-access', 'legacy']);
        expect(cfg.arguments).toEqual(['--warn-as-hint', 'presence-test-non-optional', '-A']);
    });

    it('ignores .ghulproj contents when multiple are present', () => {
        const workspace = ws();
        const proj = `<?xml version="1.0"?>
<Project Sdk="Ghul.Sdk">
    <PropertyGroup><GhulCompiler>should-be-ignored</GhulCompiler></PropertyGroup>
</Project>`;
        writeFileSync(join(workspace, 'a.ghulproj'), proj);
        writeFileSync(join(workspace, 'b.ghulproj'), proj);
        writeJson(workspace, 'ghul.json', { compiler: ['from-json'] });

        const cfg = getGhulConfig(workspace);
        // Compiler must come from ghul.json (or fallback), not the proj files:
        expect(cfg.compiler).toEqual(['from-json']);
    });

    describe('problem reporting', () => {
        // getGhulConfig must never throw on bad input: a malformed file or a
        // missing compiler becomes a recorded problem so the caller can back
        // off and surface a diagnostic, rather than crashing the server.

        it('records no problems for a cleanly-configured workspace', () => {
            const workspace = ws();
            writeJson(workspace, 'ghul.json', { compiler: ['c'], source: ['src'] });

            const cfg = getGhulConfig(workspace);
            expect(cfg.problems).toEqual([]);
        });

        it('records a problem for malformed ghul.json instead of throwing', () => {
            const workspace = ws();
            writeFileSync(join(workspace, 'ghul.json'), '{ this is not json');

            let cfg!: ReturnType<typeof getGhulConfig>;
            expect(() => { cfg = getGhulConfig(workspace); }).not.toThrow();
            expect(cfg.problems.some(p => p.includes('ghul.json'))).toBe(true);
        });

        it('records a problem for an unparseable .ghulproj instead of throwing', () => {
            const workspace = ws();
            writeFileSync(join(workspace, 'test.ghulproj'), '<Project><not-closed>');

            let cfg!: ReturnType<typeof getGhulConfig>;
            expect(() => { cfg = getGhulConfig(workspace); }).not.toThrow();
            expect(cfg.problems.some(p => p.includes('test.ghulproj'))).toBe(true);
        });

        it('records a problem for malformed .assemblies.json instead of throwing', () => {
            const workspace = ws();
            writeJson(workspace, 'ghul.json', { compiler: ['c'], source: ['src'] });
            writeFileSync(join(workspace, '.assemblies.json'), 'not json at all');

            let cfg!: ReturnType<typeof getGhulConfig>;
            expect(() => { cfg = getGhulConfig(workspace); }).not.toThrow();
            expect(cfg.problems.some(p => p.includes('.assemblies.json'))).toBe(true);
        });

        it('records a problem for malformed .config/dotnet-tools.json instead of throwing', () => {
            const workspace = ws();
            mkdirSync(join(workspace, '.config'));
            writeFileSync(join(workspace, '.config/dotnet-tools.json'), '{ broken');

            let cfg!: ReturnType<typeof getGhulConfig>;
            expect(() => { cfg = getGhulConfig(workspace); }).not.toThrow();
            expect(cfg.problems.some(p => p.includes('dotnet-tools.json'))).toBe(true);
        });

        it('records a problem when no compiler can be resolved', () => {
            // An empty workspace has no ghul.json compiler, no tool manifest
            // and (in the test environment) no installed ghul-compiler.
            const workspace = ws();

            const cfg = getGhulConfig(workspace);
            expect(cfg.compiler).toBeUndefined();
            expect(cfg.problems.some(p => p.includes('compiler'))).toBe(true);
        });
    });
});
