import Gio from 'gi://Gio';

import {Context} from '../extension/src/core/context.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {findActiveConflicts, KNOWN_CONFLICTS} from '../extension/src/core/conflicts.js';
import {assert, assertEqual} from './helpers.js';

assertEqual(KNOWN_CONFLICTS.dock[0].uuid, 'ubuntu-dock@ubuntu.com',
    'Ubuntu Dock is the dock conflict');

assertEqual(KNOWN_CONFLICTS.tiling[0].uuid, 'tiling-assistant@ubuntu.com',
    'Tiling Assistant is the tiling conflict');

const active = findActiveConflicts('dock', uuid => ({
    state: uuid === 'ubuntu-dock@ubuntu.com' ? 1 : 2,
}));
assertEqual(active.length, 1, 'one active conflict is found');
assertEqual(active[0].name, 'Ubuntu Dock', 'the conflict name is readable');

const inactive = findActiveConflicts('dock', () => ({state: 2}));
assertEqual(inactive.length, 0, 'inactive extensions do not conflict');

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
const settings = new Gio.Settings({settings_schema: schema});
settings.set_boolean('dock-enabled', true);

const context = new Context({uuid: 'test'}, settings, {
    extensionManager: {
        lookup: uuid => ({
            state: uuid === 'ubuntu-dock@ubuntu.com' ? 1 : 2,
        }),
    },
});
const registry = new ModuleRegistry(context);
let dockEnabled = false;
registry.add('dock', {
    enable() {
        dockEnabled = true;
    },
    disable() {
        dockEnabled = false;
    },
}, 'dock-enabled');

registry.enableAll();
assertEqual(dockEnabled, false, 'conflicted dock stays off');
assertEqual(registry.status('dock'), 'blocked', 'conflict is recorded');
assert(context.snapshot().modules.dock.detail.includes('Ubuntu Dock'),
    'conflict detail names the extension');

print('conflict tests passed');
