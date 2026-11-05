import Adw from 'gi://Adw';

import {resetRow, switchRow, textRow} from './helpers.js';

export function buildLockscreenPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Lockscreen',
        icon_name: 'system-lock-screen-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'lockscreen-enabled', 'Enable lockscreen',
        'Active only while the screen is locked. Applies when the extension is re-enabled.'));

    const clock = new Adw.PreferencesGroup({title: 'Clock'});
    page.add(clock);
    clock.add(textRow(settings, 'lockscreen-clock-format', 'Clock format',
        'GLib strftime format, for example %H:%M.'));
    clock.add(textRow(settings, 'lockscreen-date-format', 'Date format',
        'GLib strftime format, for example %A, %B %-d.'));
    clock.add(textRow(settings, 'lockscreen-message', 'Message',
        'Optional line under the date.'));

    const background = new Adw.PreferencesGroup({title: 'Background'});
    page.add(background);
    background.add(textRow(settings, 'lockscreen-wallpaper-uri', 'Wallpaper URI',
        'Optional file:// URI. Empty uses the current wallpaper.'));

    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'lockscreen'));

    return page;
}
