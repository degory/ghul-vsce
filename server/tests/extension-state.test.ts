import { ExtensionState } from '../src/extension-state';

// ExtensionState now owns the workspace registry only — the LSP Connection
// and per-workspace state (compiler child, watchdog, response handler) live
// on WorkspaceContext. These tests cover the registry + URI router; the
// connect() bootstrap and per-workspace lifecycle are exercised in
// integration testing rather than here.

describe('ExtensionState registry', () => {
    beforeEach(() => {
        ExtensionState.getInstance().reset();
    });

    afterEach(() => {
        ExtensionState.getInstance().reset();
    });

    it('getInstance returns the same instance on subsequent calls', () => {
        expect(ExtensionState.getInstance()).toBe(ExtensionState.getInstance());
    });

    it('allWorkspaces returns an empty list when nothing is registered', () => {
        expect(ExtensionState.getInstance().allWorkspaces()).toEqual([]);
    });

    it('defaultWorkspace returns null when nothing is registered', () => {
        expect(ExtensionState.getInstance().defaultWorkspace()).toBeNull();
    });

    it('getWorkspaceForUri returns null when nothing is registered', () => {
        expect(
            ExtensionState.getInstance().getWorkspaceForUri('file:///some/file.ghul')
        ).toBeNull();
    });

    // A workspace stands in for a registered WorkspaceContext: the router
    // reads its root and asks whether the project's sources include the file,
    // and constructing a real one would start a compiler.
    function registerFake(workspace_root: string, sources: string[] | null) {
        const fake = {
            workspace_root,
            claimsSourceFile: (uri: string) =>
                sources == null || sources.some(source => uri.endsWith(source))
        };

        (ExtensionState.getInstance() as any).workspaces.set(workspace_root, fake);

        return fake;
    }

    it('routes a file to the nested project whose sources include it', () => {
        const outer = registerFake('/w/main', ['/w/main/src/a.ghul']);
        const inner = registerFake('/w/main/unit-tests', ['/w/main/unit-tests/src/t.ghul']);

        expect(
            ExtensionState.getInstance()
                .getWorkspaceForUri('file:///w/main/unit-tests/src/t.ghul')
        ).toBe(inner);

        expect(
            ExtensionState.getInstance().getWorkspaceForUri('file:///w/main/src/a.ghul')
        ).toBe(outer);
    });

    it('does not route a file the containing project does not compile', () => {
        registerFake('/w/main', ['/w/main/src/a.ghul']);

        expect(
            ExtensionState.getInstance()
                .getWorkspaceForUri('file:///w/main/unit-tests/src/t.ghul')
        ).toBeNull();
    });

    it('routes by containing folder while a project has no resolved sources', () => {
        const outer = registerFake('/w/main', null);

        expect(
            ExtensionState.getInstance()
                .getWorkspaceForUri('file:///w/main/anything.ghul')
        ).toBe(outer);
    });

    it('getWorkspaceForUri returns null for malformed URIs', () => {
        // A junk string with no parseable scheme: vscode-uri returns an empty
        // fsPath, which the router treats as "no owning workspace" rather than
        // routing arbitrarily.
        expect(
            ExtensionState.getInstance().getWorkspaceForUri('not a uri')
        ).toBeNull();
    });
});
