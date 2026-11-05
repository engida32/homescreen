import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapRect, TILING_SHORTCUTS} from './tilingGeometry.js';

export class TilingModule {
    constructor() {
        this._settings = null;
        this._logger = null;
        this._keys = [];
    }

    enable(context) {
        this._settings = context.settings;
        this._logger = context.logger;

        try {
            for (const [key, layout] of Object.entries(TILING_SHORTCUTS)) {
                Main.wm.addKeybinding(
                    key,
                    this._settings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL,
                    () => this._apply(layout)
                );
                this._keys.push(key);
            }
        } catch (error) {
            this._unbind();
            this._settings = null;
            this._logger = null;
            throw error;
        }
    }

    _apply(layout) {
        if (!this._settings)
            return;

        try {
            const window = global.display.get_focus_window();
            if (!window || window.is_skip_taskbar())
                return;
            if (window.get_window_type() !== Meta.WindowType.NORMAL)
                return;

            const flags = window.get_maximize_flags();
            if (flags)
                window.unmaximize(flags);
            if (window.is_fullscreen())
                window.unmake_fullscreen();

            if (!window.allows_move() || !window.allows_resize())
                return;

            window.unminimize();

            const monitor = window.get_monitor() >= 0
                ? window.get_monitor()
                : global.display.get_current_monitor();
            const workArea = window.get_work_area_for_monitor(monitor) ??
                window.get_work_area_current_monitor();
            if (!workArea)
                return;

            const rect = snapRect(
                workArea,
                layout,
                this._settings.get_int('tiling-gap')
            );

            // GNOME Shell 50.1 /usr/lib/gnome-shell/libshell-18.so uses this
            // move_to_monitor plus move_frame plus move_resize_frame order.
            window.move_to_monitor(monitor);
            window.move_frame(true, rect.x, rect.y);
            window.move_resize_frame(true, rect.x, rect.y,
                rect.width, rect.height);
            window.raise();
        } catch (error) {
            this._logger?.error('tiling failed', error);
        }
    }

    _unbind() {
        for (const key of this._keys) {
            try {
                Main.wm.removeKeybinding(key);
            } catch {
                // The binding may not have been registered.
            }
        }
        this._keys = [];
    }

    disable() {
        this._unbind();
        this._settings = null;
        this._logger = null;
    }
}
