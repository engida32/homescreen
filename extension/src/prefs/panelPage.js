import Adw from 'gi://Adw';

import {comboRow, resetRow, shortcutRow, spinRow, spinRowDouble, switchRow} from './helpers.js';

export function buildPanelPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Panel',
        icon_name: 'focus-top-bar-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'panel-enabled', 'Enable panel',
        'Applies when the extension is re-enabled.'));

    const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
    page.add(behavior);
    behavior.add(comboRow(settings, 'panel-mode', 'Visibility', [
        'always',
        'autohide',
        'intellihide',
        'hidden',
    ]));
    behavior.add(shortcutRow(settings, 'panel-toggle-shortcut', 'Toggle shortcut'));

    const timing = new Adw.PreferencesGroup({title: 'Timing'});
    page.add(timing);
    timing.add(spinRow(settings, 'panel-hide-delay', 'Hide delay',
        'Milliseconds after the pointer leaves the panel.', 0, 5000, 100));
    timing.add(spinRow(settings, 'panel-reveal-pressure', 'Reveal pressure',
        'Pressure needed at the top edge. Lower is easier.', 0, 500, 10));
    timing.add(spinRow(settings, 'panel-pressure-timeout', 'Pressure timeout',
        'Milliseconds the pointer must rest at the edge.', 100, 3000, 100));
    timing.add(spinRowDouble(settings, 'panel-animation-time', 'Animation time',
        'Seconds for the panel to slide in and out.', 0.0, 0.6, 0.01));

    const overview = new Adw.PreferencesGroup({title: 'Overview'});
    page.add(overview);
    overview.add(switchRow(settings, 'panel-show-in-overview',
        'Show in overview', 'Keep the panel visible while the overview is open.'));
    overview.add(switchRow(settings, 'panel-show-fullscreen',
        'Show over fullscreen', 'Allow the panel to reveal over fullscreen windows.'));
    overview.add(switchRow(settings, 'panel-show-workspace-indicator',
        'Workspace indicator', 'Show the current workspace number in the panel.'));

    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'panel'));

    return page;
}
