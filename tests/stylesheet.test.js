import GLib from 'gi://GLib';

import {dockBackgroundStyle} from '../extension/src/modules/dock/dockStyle.js';
import {assert, assertEqual} from './helpers.js';

const path = GLib.build_filenamev([GLib.get_current_dir(), 'extension', 'stylesheet.css']);
const [ok, bytes] = GLib.file_get_contents(path);
assert(ok, 'stylesheet exists');
const css = new TextDecoder().decode(bytes);

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const selector of [
    '.homescreen-panel',
    '#panel.homescreen-panel',
    '.homescreen-dock',
    '.homescreen-dock-background',
    '.homescreen-dock-box',
    '.homescreen-dock-icon',
    '.homescreen-running',
    '.homescreen-dock-label',
]) {
    const rule = new RegExp(`(^|\\n)\\s*${escapeRegex(selector)}(?=[\\s,{:.\\[#])`);
    assert(rule.test(css), `missing ${selector}`);
}

assertEqual(
    dockBackgroundStyle(24, 0.72),
    'border-radius: 24px; background-color: rgba(28, 28, 30, 0.72);',
    'dock background style'
);

assertEqual(
    dockBackgroundStyle(32, 1.0),
    'border-radius: 32px; background-color: rgba(28, 28, 30, 1);',
    'dock background style at max radius and opacity'
);

print('stylesheet tests passed');
