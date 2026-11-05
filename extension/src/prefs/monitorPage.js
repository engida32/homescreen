import Adw from 'gi://Adw';

import {resetRow, spinRow, switchRow} from './helpers.js';

export function buildMonitorPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Monitor',
        icon_name: 'utilities-system-monitor-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({
        title: 'General',
        description: 'Reads /proc and /sys asynchronously. No root access is required.',
    });
    page.add(general);
    general.add(switchRow(settings, 'monitor-enabled', 'Enable system monitor',
        'Applies when the extension is re-enabled.'));
    general.add(spinRow(settings, 'monitor-interval', 'Refresh interval',
        'Seconds between samples. One second is the minimum.', 1, 10, 1));

    const metrics = new Adw.PreferencesGroup({title: 'Menu metrics'});
    page.add(metrics);
    metrics.add(switchRow(settings, 'monitor-show-memory', 'Show memory'));
    metrics.add(switchRow(settings, 'monitor-show-disk', 'Show disk usage'));
    metrics.add(switchRow(settings, 'monitor-show-network', 'Show network rates'));
    metrics.add(switchRow(settings, 'monitor-show-temperature', 'Show temperature'));

    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'monitor'));

    return page;
}
