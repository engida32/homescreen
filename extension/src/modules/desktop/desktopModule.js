import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {hideDingIcons, restoreDing, snapshotDing} from './ding.js';

const DING_SCHEMA = 'org.gnome.shell.extensions.ding';
const SHORTCUT_KEY = 'desktop-show-desktop-shortcut';
const ACTION_MODE = Shell.ActionMode.NORMAL;

export class DesktopModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._context = null;
        this._ding = null;
        this._dingSnapshot = null;
        this._desktopWindows = [];
        this._keybindingBound = false;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._context = context;

        try {
            this._ding = this._findDingSettings();
            if (this._ding) {
                this._dingSnapshot = snapshotDing(this._ding);
                this._applyIcons();
            }

            this._scope.signal(this._settings, 'changed::desktop-hide-icons', () => this._applyIcons());
            this._scope.signal(this._settings, 'changed::desktop-focus-mode', () => this._applyFocusMode());
            this._scope.signal(this._settings, 'changed::desktop-show-desktop-shortcut', () => this._rebindShortcut());

            this._bindShortcut();
            this._applyFocusMode();
        } catch (error) {
            this._teardown();
            throw error;
        }
    }

    _findDingSettings() {
        try {
            const source = Gio.SettingsSchemaSource.get_default();
            const schema = source.lookup(DING_SCHEMA, true);
            return schema ? new Gio.Settings({settings_schema: schema}) : null;
        } catch {
            return null;
        }
    }

    _applyIcons() {
        if (!this._ding)
            return;
        if (this._settings.get_boolean('desktop-hide-icons'))
            hideDingIcons(this._ding);
        else
            restoreDing(this._ding, this._dingSnapshot);
    }

    _applyFocusMode() {
        const focusMode = this._settings.get_boolean('desktop-focus-mode');
        this._context.getModule('panel')?.setForcedHidden(focusMode);
        this._context.getModule('dock')?.setForcedHidden(focusMode);
    }

    _bindShortcut() {
        Main.wm.addKeybinding(
            SHORTCUT_KEY,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            ACTION_MODE,
            () => this._toggleDesktop()
        );
        this._keybindingBound = true;
    }

    _rebindShortcut() {
        if (this._keybindingBound) {
            Main.wm.removeKeybinding(SHORTCUT_KEY);
            this._keybindingBound = false;
        }
        this._bindShortcut();
    }

    _toggleDesktop() {
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window &&
                window.get_window_type() === Meta.WindowType.NORMAL);

        const alive = this._desktopWindows.filter(window =>
            window.get_compositor_private());
        if (alive.length > 0) {
            for (const window of alive)
                window.unminimize();
            this._desktopWindows = [];
            return;
        }

        this._desktopWindows = windows.filter(window => !window.minimized);
        for (const window of this._desktopWindows)
            window.minimize();
    }

    _teardown() {
        if (this._keybindingBound) {
            try {
                Main.wm.removeKeybinding(SHORTCUT_KEY);
            } catch {
                // The binding may not have been registered.
            }
            this._keybindingBound = false;
        }

        try {
            this._context?.getModule('panel')?.setForcedHidden(false);
        } catch {
            // Best-effort cleanup.
        }

        try {
            this._context?.getModule('dock')?.setForcedHidden(false);
        } catch {
            // Best-effort cleanup.
        }

        if (this._ding && this._dingSnapshot) {
            try {
                restoreDing(this._ding, this._dingSnapshot);
            } catch {
                // Best-effort cleanup.
            }
        }

        this._desktopWindows = [];
        this._context = null;
        this._ding = null;
        this._dingSnapshot = null;
    }

    disable() {
        this._teardown();
    }
}
