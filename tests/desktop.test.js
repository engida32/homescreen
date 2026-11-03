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

const original = {
    'show-home': false,
    'show-trash': true,
    'show-volumes': false,
    'show-network-volumes': true,
};

const settings = new FakeSettings(original);

const snapshot = snapshotDing(settings);
for (const key of DING_KEYS)
    assertEqual(snapshot[key], original[key], `snapshot captures ${key}`);
hideDingIcons(settings);
for (const key of DING_KEYS)
    assertEqual(settings.get_boolean(key), false, `${key} is hidden`);
restoreDing(settings, snapshot);
for (const key of DING_KEYS)
    assertEqual(settings.get_boolean(key), original[key], `${key} is restored`);

const partial = {...snapshot};
delete partial['show-trash'];
for (const key of DING_KEYS)
    settings.set_boolean(key, false);
restoreDing(settings, partial);
assertEqual(settings.get_boolean('show-trash'), false, 'missing key stays unchanged');
for (const key of DING_KEYS) {
    if (key === 'show-trash')
        continue;
    assertEqual(settings.get_boolean(key), original[key], `${key} restores from partial snapshot`);
}

print('desktop tests passed');
