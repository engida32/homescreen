import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Context} from './src/core/context.js';
import {ModuleRegistry} from './src/core/registry.js';
import {PanelModule} from './src/modules/panel/panelModule.js';
import {DockModule} from './src/modules/dock/dockModule.js';
import {DesktopModule} from './src/modules/desktop/desktopModule.js';
import {LockscreenModule} from './src/modules/lockscreen/lockscreenModule.js';
import {VisualModule} from './src/modules/visual/visualModule.js';
import {TilingModule} from './src/modules/tiling/tilingModule.js';
import {MonitorModule} from './src/modules/monitor/monitorModule.js';
import {AppGridModule} from './src/modules/appGrid/appGridModule.js';

export default class HomescreenExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._context = new Context(this, this._settings, {
            sessionMode: Main.sessionMode,
            extensionManager: Main.extensionManager,
        });
        this._registry = new ModuleRegistry(this._context);

        this._registry.add('panel', new PanelModule(), 'panel-enabled');
        this._registry.add('dock', new DockModule(), 'dock-enabled');
        this._registry.add('visual', new VisualModule(), 'visual-enabled');
        this._registry.add('tiling', new TilingModule(), 'tiling-enabled');
        this._registry.add('monitor', new MonitorModule(), 'monitor-enabled');
        this._registry.add('app-grid', new AppGridModule(), 'app-grid-enabled');
        this._registry.add('desktop', new DesktopModule(), 'desktop-enabled');
        this._registry.add('lockscreen', new LockscreenModule(), 'lockscreen-enabled',
            {sessionModes: ['unlock-dialog']});

        this._settingsSignals = [
            this._settings.connect('changed::reload-request',
                () => this._registry.reload()),
            this._settings.connect('changed::diagnostics-request',
                () => this._context.diagnostics.refresh(
                    this._context.resourceCounts())),
        ];

        this._sessionSignal = Main.sessionMode.connect('updated', () => this._registry.sync());
        this._registry.enableAll();
    }

    disable() {
        for (const id of this._settingsSignals ?? [])
            this._settings.disconnect(id);
        this._settingsSignals = [];

        if (this._sessionSignal) {
            Main.sessionMode.disconnect(this._sessionSignal);
            this._sessionSignal = 0;
        }
        this._registry?.disableAll();
        this._context?.destroy();
        this._registry = null;
        this._context = null;
        this._settings = null;
    }
}
