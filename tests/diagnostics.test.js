import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Context} from '../extension/src/core/context.js';
import {Diagnostics} from '../extension/src/core/diagnostics.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {assertEqual} from './helpers.js';

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
if (!schema)
    throw new Error('schema not compiled; run make schemas first');
const settings = new Gio.Settings({settings_schema: schema});

const context = new Context({uuid: 'test'}, settings);
const scope = context.scope('panel');
scope.signal(settings, 'changed::panel-mode', () => {});
scope.timeout(60000, () => GLib.SOURCE_CONTINUE);

const counts = context.resourceCounts();
assertEqual(counts.panel.signals, 1, 'one panel signal');
assertEqual(counts.panel.sources, 1, 'one panel source');

context.diagnostics.refresh(counts);
const snapshot = JSON.parse(settings.get_string('diagnostics-json'));
assertEqual(snapshot.resources.panel.signals, 1, 'diagnostics writes signals');
assertEqual(snapshot.resources.panel.sources, 1, 'diagnostics writes sources');

context.releaseScope(scope);
assertEqual(Object.keys(context.resourceCounts()).length, 0, 'released scope disappears');

const log = [];
const module = {
    enable() {
        log.push('enable');
    },
    disable() {
        log.push('disable');
    },
};
settings.set_boolean('panel-enabled', true);
const reloadContext = new Context({uuid: 'test'}, settings);
const registry = new ModuleRegistry(reloadContext);
registry.add('panel', module, 'panel-enabled');
registry.enableAll();
registry.reload();
assertEqual(log.join(','), 'enable,disable,enable', 'reload restarts modules');

const direct = new Diagnostics(settings, context.logger);
direct.refresh({panel: {signals: 3, sources: 2}});
const directSnapshot = JSON.parse(settings.get_string('diagnostics-json'));
assertEqual(directSnapshot.resources.panel.signals, 3, 'direct refresh signals');
assertEqual(directSnapshot.resources.panel.sources, 2, 'direct refresh sources');

print('diagnostics tests passed');
