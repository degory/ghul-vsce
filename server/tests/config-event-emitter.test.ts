import { ConfigEventEmitter } from '../src/config-event-emitter';
import { GhulConfig } from '../src/ghul-config';

describe('ConfigEventEmitter', () => {
    let configEventEmitter: ConfigEventEmitter;

    beforeEach(() => {
        configEventEmitter = new ConfigEventEmitter();
    });

    it('should emit config-available event', () => {
        const workspace = 'workspace';
        const config: GhulConfig = { compiler: '', source: [], arguments: [], want_plaintext_hover: true };
        const handler = jest.fn();

        configEventEmitter.onConfigAvailable(handler);
        configEventEmitter.configAvailable(workspace, config);

        expect(handler).toHaveBeenCalledWith(workspace, config);
    });

    it('should set the config-available event handler', () => {
        const handler = jest.fn();

        configEventEmitter.onConfigAvailable(handler);

        expect(configEventEmitter.listeners('config-available')).toContain(handler);
    });
});