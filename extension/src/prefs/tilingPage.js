import Adw from 'gi://Adw';

import {createConflictBanner, revealIfEnabled} from './conflicts.js';
import {resetRow, shortcutRow, spinRow, switchRow} from './helpers.js';

export function buildTilingPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Tiling',
        icon_name: 'view-grid-symbolic',
    });
    window.add(page);

    const conflictGroup = new Adw.PreferencesGroup({title: 'Compatibility'});
    page.add(conflictGroup);
    const conflict = createConflictBanner(
        'tiling-assistant@ubuntu.com',
        'Tiling Assistant'
    );
    conflictGroup.add(conflict);
    revealIfEnabled(conflict, 'tiling-assistant@ubuntu.com');

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'tiling-enabled', 'Enable keyboard tiling',
        'Applies when the extension is re-enabled.'));
    general.add(spinRow(settings, 'tiling-gap', 'Gap',
        'Pixels between tiled windows and screen edges.', 0, 32, 1));

    const shortcuts = new Adw.PreferencesGroup({
        title: 'Keyboard shortcuts',
        description: 'Snap the focused window. Shortcut rows are display-only.',
    });
    page.add(shortcuts);
    shortcuts.add(shortcutRow(settings, 'tiling-half-left-shortcut',
        'Left half'));
    shortcuts.add(shortcutRow(settings, 'tiling-half-right-shortcut',
        'Right half'));
    shortcuts.add(shortcutRow(settings, 'tiling-half-top-shortcut',
        'Top half'));
    shortcuts.add(shortcutRow(settings, 'tiling-half-bottom-shortcut',
        'Bottom half'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-top-left-shortcut',
        'Top-left quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-top-right-shortcut',
        'Top-right quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-bottom-left-shortcut',
        'Bottom-left quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-bottom-right-shortcut',
        'Bottom-right quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-full-shortcut',
        'Full work area'));

    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'tiling'));

    return page;
}
