import Adw from 'gi://Adw';

import {resetRow, spinRow, spinRowDouble, switchRow} from './helpers.js';

export function buildVisualPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Visual',
        icon_name: 'preferences-desktop-display-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'visual-enabled', 'Enable visual effects',
        'Applies when the extension is re-enabled.'));

    const blur = new Adw.PreferencesGroup({title: 'Blur'});
    page.add(blur);
    blur.add(switchRow(settings, 'visual-blur-panel', 'Blur behind the panel',
        'Uses the native Shell blur effect and lowers the panel opacity.'));
    blur.add(switchRow(settings, 'visual-blur-dock', 'Blur behind the dock',
        'Uses the native Shell blur effect and clears the dock background color.'));
    blur.add(switchRow(settings, 'visual-blur-overview', 'Blur the overview wallpaper',
        'Applies only while the overview is open.'));
    blur.add(spinRow(settings, 'visual-blur-radius', 'Blur radius',
        'Pixels. Higher values are softer and more expensive.', 8, 64, 1));
    blur.add(spinRowDouble(settings, 'visual-blur-brightness', 'Blur brightness',
        'Darkens or brightens the blurred surface.', 0.0, 1.0, 0.01));

    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'visual'));

    return page;
}
