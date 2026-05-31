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

    it('getWorkspaceForUri returns null for malformed URIs', () => {
        // A junk string with no parseable scheme: vscode-uri returns an empty
        // fsPath, which the router treats as "no owning workspace" rather than
        // routing arbitrarily.
        expect(
            ExtensionState.getInstance().getWorkspaceForUri('not a uri')
        ).toBeNull();
    });
});
