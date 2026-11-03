import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Context} from './src/core/context.js';
import {ModuleRegistry} from './src/core/registry.js';
import {PanelModule} from './src/modules/panel/panelModule.js';
import {DockModule} from './src/modules/dock/dockModule.js';
import {DesktopModule} from './src/modules/desktop/desktopModule.js';

export default class HomescreenExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._context = new Context(this, this._settings);
        this._registry = new ModuleRegistry(this._context);

        this._registry.add('panel', new PanelModule(), 'panel-enabled');
        this._registry.add('dock', new DockModule(), 'dock-enabled');
        this._registry.add('desktop', new DesktopModule(), 'desktop-enabled');

        this._registry.enableAll();
    }

    disable() {
        this._registry?.disableAll();
        this._context?.destroy();
        this._registry = null;
        this._context = null;
        this._settings = null;
    }
}
