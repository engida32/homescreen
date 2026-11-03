import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const HomescreenDockIcon = GObject.registerClass(
class HomescreenDockIcon extends Dash.DashIcon {
    _init(app) {
        super._init(app);
        this.add_style_class_name('homescreen-dock-icon');
        this.app.connectObject(
            'windows-changed',
            () => this._syncRunning(),
            this
        );
        this.app.connectObject(
            'notify::state',
            () => this._syncRunning(),
            this
        );
        this._syncRunning();
    }

    _syncRunning() {
        const running = this.app.state === Shell.AppState.RUNNING &&
            this.app.get_windows().length > 0;
        if (running)
            this.add_style_class_name('homescreen-running');
        else
            this.remove_style_class_name('homescreen-running');
    }

    activate(button) {
        const app = this.app;

        if (button === Clutter.BUTTON_MIDDLE) {
            if (app.can_open_new_window())
                app.open_new_window(-1);
            else
                app.activate();
            return;
        }

        const windows = app.get_windows();
        if (windows.length === 0) {
            this.animateLaunch();
            app.activate();
            return;
        }

        const focused = global.display.focus_window;
        if (focused && windows.includes(focused)) {
            for (const window of windows)
                window.minimize();
            return;
        }

        Main.activateWindow(windows[0]);
    }
});
