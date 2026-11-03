import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildPanelPage} from './src/prefs/panelPage.js';

export default class HomescreenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(760, 620);
        window.set_title(_('Homescreen'));
        const settings = this.getSettings();
        buildPanelPage(window, settings);
    }
}
