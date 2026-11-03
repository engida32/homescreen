import Gio from 'gi://Gio';

import {Context} from '../extension/src/core/context.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {assert, assertEqual} from './helpers.js';

const log = [];
const extension = {uuid: 'test'};
const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
if (!schema)
    throw new Error('schema not compiled; run make schemas first');
const settings = new Gio.Settings({settings_schema: schema});
settings.set_boolean('panel-enabled', true);
settings.set_boolean('dock-enabled', true);

const context = new Context(extension, settings);
const registry = new ModuleRegistry(context);

const first = {
    enable(moduleContext) {
        log.push('first-enable');
        this.scope = moduleContext.scope;
        this.scope.signal(settings, 'changed::panel-mode', () => log.push('panel-mode'));
    },
    disable() {
        log.push('first-disable');
    },
};

function boom() {
    throw new Error('boom');
}

const second = {
    enable() {
        log.push('second-enable');
        boom();
    },
    disable() {
        log.push('second-disable');
    },
};

registry.add('first', first, 'panel-enabled');
registry.add('second', second, 'dock-enabled');

registry.enableAll();

assertEqual(log.join(','), 'first-enable,second-enable', 'enable order and failure isolation');
assertEqual(registry.status('first'), 'enabled', 'first is enabled');
assertEqual(registry.status('second'), 'failed', 'second is failed');
assert(context.snapshot().modules.second.detail.includes('boom'), 'failure is recorded');
assert(context.logger.entries().some(entry => entry.message.includes('boom')), 'intentional failure is logged');

registry.disableAll();
assertEqual(log[log.length - 1], 'first-disable', 'enabled modules disable in reverse order');
assertEqual(registry.status('first'), 'disabled', 'first is disabled after shutdown');
assertEqual(context.scopeCount, 0, 'all scopes are destroyed');

print('registry tests passed');
