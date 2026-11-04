import Adw from 'gi://Adw';

import {spinRow, switchRow} from './helpers.js';

export function buildAppGridPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'App Grid',
        icon_name: 'view-app-grid-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'app-grid-enabled', 'Enable app grid customization',
        'Applies when the extension is re-enabled.'));
    general.add(switchRow(settings, 'app-grid-alphabetical', 'Sort alphabetically',
        'Overrides the saved app-picker layout while enabled.'));
    general.add(switchRow(settings, 'app-grid-launchpad', 'Launchpad mode',
        'Makes the overview toggle open the app grid first.'));

    const layout = new Adw.PreferencesGroup({title: 'Layout'});
    page.add(layout);
    layout.add(spinRow(settings, 'app-grid-rows', 'Rows per page',
        'Between 2 and 8.', 2, 8, 1));
    layout.add(spinRow(settings, 'app-grid-columns', 'Columns per page',
        'Between 2 and 10.', 2, 10, 1));
    layout.add(spinRow(settings, 'app-grid-icon-size', 'Icon size',
        'Pixels. Larger icons may reduce the usable grid.', 32, 96, 1));
    layout.add(switchRow(settings, 'app-grid-show-labels', 'Show app labels'));

    const search = new Adw.PreferencesGroup({title: 'Search'});
    page.add(search);
    search.add(switchRow(settings, 'app-grid-disable-remote-search',
        'Disable remote search',
        'Turns off external search providers while the module is enabled.'));

    return page;
}
