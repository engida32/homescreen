import Adw from 'gi://Adw';

import {resetRow, shortcutRow, switchRow} from './helpers.js';

export function buildDesktopPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Desktop',
        icon_name: 'user-desktop-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'desktop-enabled', 'Enable desktop',
        'Applies when the extension is re-enabled.'));

    const desktop = new Adw.PreferencesGroup({title: 'Desktop'});
    page.add(desktop);
    desktop.add(switchRow(settings, 'desktop-hide-icons', 'Hide desktop icons',
        'Keep DING icons hidden while Homescreen is enabled.'));
    desktop.add(switchRow(settings, 'desktop-focus-mode', 'Focus mode',
        'Hide the panel and dock.'));
    desktop.add(shortcutRow(settings, 'desktop-show-desktop-shortcut',
        'Show desktop shortcut'));

    const system = new Adw.PreferencesGroup({title: 'System'});
    page.add(system);
    system.add(switchRow(settings, 'desktop-mute-notifications',
        'Mute notifications', 'Hide notification banners while enabled.'));
    system.add(switchRow(settings, 'desktop-caffeine',
        'Caffeine', 'Inhibit idle and suspend while enabled.'));
    system.add(switchRow(settings, 'desktop-macos-controls',
        'macOS window controls', 'Use close, minimize, maximize order.'));

    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'desktop'));

    return page;
}
