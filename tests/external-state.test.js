import {assertEqual, waitFor} from './helpers.js';
import {
    restoreBooleanIfApplied,
    restoreBooleanIfUnchanged,
    restoreStringIfApplied,
    restoreStringIfUnchanged,
    snapshotBoolean,
    snapshotString,
} from '../extension/src/modules/desktop/externalState.js';
import {CAFFEINE_FLAGS, CaffeineInhibitor} from '../extension/src/modules/desktop/caffeine.js';

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

    get_string(key) {
        return this.values[key];
    }

    set_string(key, value) {
        this.values[key] = value;
    }
}

const notifications = new FakeSettings({'show-banners': true});
const bannerSnapshot = snapshotBoolean(notifications, 'show-banners');
notifications.set_boolean('show-banners', false);
restoreBooleanIfUnchanged(notifications, 'show-banners', false, bannerSnapshot);
assertEqual(notifications.get_boolean('show-banners'), true, 'banner restored');

const changed = new FakeSettings({'show-banners': true});
const changedSnapshot = snapshotBoolean(changed, 'show-banners');
changed.set_boolean('show-banners', false);
changed.set_boolean('show-banners', true);
restoreBooleanIfUnchanged(changed, 'show-banners', false, changedSnapshot);
assertEqual(changed.get_boolean('show-banners'), true, 'changed banner kept');

const wm = new FakeSettings({'button-layout': 'appmenu:minimize,maximize,close'});
const layoutSnapshot = snapshotString(wm, 'button-layout');
wm.set_string('button-layout', 'appmenu:close,minimize,maximize');
restoreStringIfUnchanged(wm, 'button-layout',
    'appmenu:close,minimize,maximize', layoutSnapshot);
assertEqual(wm.get_string('button-layout'),
    'appmenu:minimize,maximize,close', 'layout restored');

const notAppliedBool = new FakeSettings({'show-banners': false});
restoreBooleanIfApplied(notAppliedBool, 'show-banners', false, false, true);
assertEqual(notAppliedBool.get_boolean('show-banners'), false,
    'not applied boolean not written');

const appliedBool = new FakeSettings({'show-banners': false});
restoreBooleanIfApplied(appliedBool, 'show-banners', true, false, true);
assertEqual(appliedBool.get_boolean('show-banners'), true,
    'applied boolean restored');

const userChangedBool = new FakeSettings({'show-banners': true});
restoreBooleanIfApplied(userChangedBool, 'show-banners', true, false, false);
assertEqual(userChangedBool.get_boolean('show-banners'), true,
    'user changed boolean kept');

const notAppliedString = new FakeSettings({
    'button-layout': 'appmenu:minimize,maximize,close',
});
restoreStringIfApplied(notAppliedString, 'button-layout', false,
    'appmenu:close,minimize,maximize', 'appmenu:minimize,maximize,close');
assertEqual(notAppliedString.get_string('button-layout'),
    'appmenu:minimize,maximize,close', 'not applied string not written');

const appliedString = new FakeSettings({
    'button-layout': 'appmenu:close,minimize,maximize',
});
restoreStringIfApplied(appliedString, 'button-layout', true,
    'appmenu:close,minimize,maximize', 'appmenu:minimize,maximize,close');
assertEqual(appliedString.get_string('button-layout'),
    'appmenu:minimize,maximize,close', 'applied string restored');

const userChangedString = new FakeSettings({'button-layout': 'close:appmenu'});
restoreStringIfApplied(userChangedString, 'button-layout', true,
    'appmenu:close,minimize,maximize', 'appmenu:minimize,maximize,close');
assertEqual(userChangedString.get_string('button-layout'), 'close:appmenu',
    'user changed string kept');

assertEqual(CAFFEINE_FLAGS, 12, 'caffeine flags');

const calls = [];
const inhibitor = new CaffeineInhibitor(async (method, params) => {
    calls.push([method, params.deepUnpack()]);
    return method === 'Inhibit' ? 42 : 0;
}, {appId: 'test', reason: 'testing'});
const cookie = waitFor(inhibitor.inhibit());
assertEqual(cookie, 42, 'inhibit cookie');
assertEqual(calls[0][0], 'Inhibit', 'inhibit called');
assertEqual(calls[0][1][3], 12, 'inhibit flags');
waitFor(inhibitor.release());
assertEqual(calls[1][0], 'Uninhibit', 'uninhibit called');
assertEqual(calls[1][1][0], 42, 'uninhibit cookie');

const lateCalls = [];
let resolveInhibit;
const late = new CaffeineInhibitor((method, params) => {
    lateCalls.push(method);
    if (method === 'Inhibit') {
        return new Promise(resolve => {
            resolveInhibit = resolve;
        });
    }
    return Promise.resolve(0);
}, {appId: 'test', reason: 'late'});
const pending = late.inhibit();
waitFor(late.release());
resolveInhibit(7);
assertEqual(waitFor(pending), 0, 'late inhibit discarded');
assertEqual(lateCalls.includes('Uninhibit'), true, 'late inhibit released');

print('external state tests passed');
