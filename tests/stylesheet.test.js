import GLib from 'gi://GLib';

import {dockBackgroundStyle} from '../extension/src/modules/dock/dockStyle.js';
import {assert, assertEqual} from './helpers.js';

const path = GLib.build_filenamev([GLib.get_current_dir(), 'extension', 'stylesheet.css']);
const [ok, bytes] = GLib.file_get_contents(path);
assert(ok, 'stylesheet exists');
const css = new TextDecoder().decode(bytes);

for (const selector of [
    '.homescreen-panel',
    '.homescreen-dock',
    '.homescreen-dock-background',
    '.homescreen-dock-box',
    '.homescreen-dock-icon',
    '.homescreen-running',
    '.homescreen-dock-label',
]) {
    assert(css.includes(selector), `missing ${selector}`);
}

assertEqual(
    dockBackgroundStyle(24, 0.72),
    'border-radius: 24px; background-color: rgba(28, 28, 30, 0.72);',
    'dock background style'
);

print('stylesheet tests passed');
