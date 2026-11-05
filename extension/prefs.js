import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildDesktopPage} from './src/prefs/desktopPage.js';
import {buildDockPage} from './src/prefs/dockPage.js';
import {buildLockscreenPage} from './src/prefs/lockscreenPage.js';
import {buildPresetsPage} from './src/prefs/presetsPage.js';
import {buildDiagnosticsPage} from './src/prefs/diagnosticsPage.js';
import {buildPanelPage} from './src/prefs/panelPage.js';
import {buildVisualPage} from './src/prefs/visualPage.js';
import {buildTilingPage} from './src/prefs/tilingPage.js';
import {buildMonitorPage} from './src/prefs/monitorPage.js';
import {buildAppGridPage} from './src/prefs/appGridPage.js';

export default class HomescreenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(800, 680);
        window.set_title(_('Homescreen'));
        const settings = this.getSettings();
        buildPanelPage(window, settings);
        buildDockPage(window, settings);
        buildVisualPage(window, settings);
        buildTilingPage(window, settings);
        buildMonitorPage(window, settings);
        buildAppGridPage(window, settings);
        buildDesktopPage(window, settings);
        buildLockscreenPage(window, settings);
        buildPresetsPage(window, settings);
        buildDiagnosticsPage(window, settings);
    }
}
