import Adw from 'gi://Adw';

import {comboRow, spinRow, spinRowDouble, switchRow} from './helpers.js';

export function buildDockPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Dock',
        icon_name: 'view-app-grid-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'dock-enabled', 'Enable dock',
        'Applies when the extension is re-enabled.'));

    const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
    page.add(behavior);
    behavior.add(comboRow(settings, 'dock-position', 'Position', ['bottom']));
    behavior.add(switchRow(settings, 'dock-autohide', 'Auto hide',
        'Hide the dock when the pointer leaves it.'));
    behavior.add(switchRow(settings, 'dock-intellihide', 'Intellihide',
        'Hide the dock when a window overlaps it.'));

    const size = new Adw.PreferencesGroup({title: 'Size and spacing'});
    page.add(size);
    size.add(spinRow(settings, 'dock-icon-size', 'Icon size',
        'Pixels.', 32, 72, 2));
    size.add(spinRow(settings, 'dock-spacing', 'Icon spacing',
        'Pixels between icons.', 4, 16, 1));
    size.add(spinRow(settings, 'dock-padding', 'Inner padding',
        'Pixels around the icons.', 4, 20, 1));
    size.add(spinRow(settings, 'dock-margin', 'Screen margin',
        'Pixels from the bottom edge.', 4, 24, 1));
    size.add(spinRow(settings, 'dock-radius', 'Corner radius',
        'Pixels.', 16, 32, 1));

    const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
    page.add(appearance);
    appearance.add(spinRowDouble(settings, 'dock-opacity', 'Opacity',
        'Background opacity.', 0.3, 1.0, 0.01));

    const motion = new Adw.PreferencesGroup({title: 'Motion'});
    page.add(motion);
    motion.add(switchRow(settings, 'dock-magnification', 'Magnification',
        'Scale icons near the pointer.'));
    motion.add(spinRowDouble(settings, 'dock-magnification-strength',
        'Magnification strength',
        'How strongly icons scale near the pointer.', 0.0, 0.45, 0.01));
    motion.add(spinRow(settings, 'dock-hide-delay', 'Hide delay',
        'Milliseconds after the pointer leaves.', 0, 2000, 50));

    return page;
}
