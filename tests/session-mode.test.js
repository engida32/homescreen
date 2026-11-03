import Gio from 'gi://Gio';

import {Context} from '../extension/src/core/context.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {assertEqual} from './helpers.js';

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
if (!schema)
    throw new Error('schema not compiled; run make schemas first');
const settings = new Gio.Settings({settings_schema: schema});
settings.set_boolean('panel-enabled', true);

const sessionMode = {currentMode: 'user'};
const log = [];
const context = new Context({uuid: 'test'}, settings, {sessionMode});
const registry = new ModuleRegistry(context);

const userModule = {
    enable() {
        log.push('user-enable');
    },
    disable() {
        log.push('user-disable');
    },
};
const lockModule = {
    enable() {
        log.push('lock-enable');
    },
    disable() {
        log.push('lock-disable');
    },
};

registry.add('user', userModule, 'panel-enabled');
registry.add('lockscreen', lockModule, null, {sessionModes: ['unlock-dialog']});

registry.enableAll();
assertEqual(log.join(','), 'user-enable', 'only user modules enable in user mode');

sessionMode.currentMode = 'unlock-dialog';
registry.sync();
assertEqual(log.join(','), 'user-enable,user-disable,lock-enable',
    'sync swaps user modules for unlock-dialog modules');
assertEqual(registry.status('user'), 'disabled', 'user module is disabled');
assertEqual(registry.status('lockscreen'), 'enabled', 'lockscreen module is enabled');

sessionMode.currentMode = 'user';
registry.sync();
assertEqual(log.join(','), 'user-enable,user-disable,lock-enable,lock-disable,user-enable',
    'sync swaps back without duplicate enable');
assertEqual(context.scopeCount, 1, 'one scope remains for the active module');

registry.disableAll();
assertEqual(log[log.length - 1], 'user-disable', 'disableAll disables the active module');
assertEqual(context.scopeCount, 0, 'all scopes are released');

print('session mode tests passed');
