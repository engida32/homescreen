import {
    DING_KEYS,
    hideDingIcons,
    restoreDing,
    snapshotDing,
} from '../extension/src/modules/desktop/ding.js';
import {assertEqual} from './helpers.js';

class FakeSettings {
    constructor(values) {
        this.values = {...values};
    }
    get_boolean(key) {
        return this.values[key];
    }
    set_boolean(key, value) {
        this.values[key] = value;
    }
}

const settings = new FakeSettings({
    'show-home': true,
    'show-trash': true,
    'show-volumes': true,
    'show-network-volumes': true,
});

const snapshot = snapshotDing(settings);
assertEqual(snapshot['show-home'], true, 'snapshot captures the original value');
hideDingIcons(settings);
for (const key of DING_KEYS)
    assertEqual(settings.get_boolean(key), false, `${key} is hidden`);
restoreDing(settings, snapshot);
for (const key of DING_KEYS)
    assertEqual(settings.get_boolean(key), true, `${key} is restored`);

print('desktop tests passed');
