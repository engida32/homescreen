import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CaffeineInhibitor} from './caffeine.js';
import {hideDingIcons, restoreDing, snapshotDing} from './ding.js';
import {
    restoreBooleanIfUnchanged,
    restoreStringIfUnchanged,
    snapshotBoolean,
    snapshotString,
} from './externalState.js';

const DING_SCHEMA = 'org.gnome.shell.extensions.ding';
const SHORTCUT_KEY = 'desktop-show-desktop-shortcut';
const ACTION_MODE = Shell.ActionMode.NORMAL;
const NOTIFICATIONS_SCHEMA = 'org.gnome.desktop.notifications';
const NOTIFICATIONS_KEY = 'show-banners';
const WM_PREFERENCES_SCHEMA = 'org.gnome.desktop.wm.preferences';
const BUTTON_LAYOUT_KEY = 'button-layout';
const MACOS_BUTTON_LAYOUT = 'appmenu:close,minimize,maximize';

export class DesktopModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._context = null;
        this._ding = null;
        this._dingSnapshot = null;
        this._notifications = null;
        this._notificationsSnapshot = null;
        this._wmPreferences = null;
        this._buttonLayoutSnapshot = null;
        this._caffeine = null;
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

            this._notifications = this._findSettings(NOTIFICATIONS_SCHEMA);
            this._notificationsSnapshot = this._notifications
                ? snapshotBoolean(this._notifications, NOTIFICATIONS_KEY)
                : null;
            this._wmPreferences = this._findSettings(WM_PREFERENCES_SCHEMA);
            this._buttonLayoutSnapshot = this._wmPreferences
                ? snapshotString(this._wmPreferences, BUTTON_LAYOUT_KEY)
                : null;
            this._caffeine = new CaffeineInhibitor(
                (method, params) => this._callSessionManager(method, params),
                {
                    appId: 'homescreen@engida32.github.io',
                    reason: 'Homescreen presentation mode',
                });

            this._scope.signal(this._settings, 'changed::desktop-hide-icons', () => this._applyIcons());
            this._scope.signal(this._settings, 'changed::desktop-focus-mode', () => this._applyFocusMode());
            this._scope.signal(this._settings, 'changed::desktop-show-desktop-shortcut', () => this._rebindShortcut());
            this._scope.signal(this._settings,
                'changed::desktop-mute-notifications',
                () => this._applyNotifications());
            this._scope.signal(this._settings,
                'changed::desktop-caffeine',
                () => this._applyCaffeine());
            this._scope.signal(this._settings,
                'changed::desktop-macos-controls',
                () => this._applyWindowControls());

            this._bindShortcut();
            this._applyFocusMode();
            this._applyNotifications();
            this._applyCaffeine();
            this._applyWindowControls();
        } catch (error) {
            this._teardown();
            throw error;
        }
    }

    _findSettings(schemaId) {
        try {
            const source = Gio.SettingsSchemaSource.get_default();
            const schema = source.lookup(schemaId, true);
            return schema ? new Gio.Settings({settings_schema: schema}) : null;
        } catch {
            return null;
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

    _callSessionManager(method, params) {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call(
                'org.gnome.SessionManager',
                '/org/gnome/SessionManager',
                'org.gnome.SessionManager',
                method,
                params,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (connection, result) => {
                    try {
                        const reply = connection.call_finish(result);
                        resolve(reply.deepUnpack()[0]);
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    _applyNotifications() {
        if (!this._notifications || this._notificationsSnapshot === null)
            return;
        if (this._settings.get_boolean('desktop-mute-notifications'))
            this._notifications.set_boolean(NOTIFICATIONS_KEY, false);
        else
            restoreBooleanIfUnchanged(this._notifications, NOTIFICATIONS_KEY,
                false, this._notificationsSnapshot);
    }

    _applyCaffeine() {
        if (!this._caffeine)
            return;
        if (this._settings.get_boolean('desktop-caffeine')) {
            this._caffeine.inhibit().catch(error =>
                this._context.logger.error('caffeine inhibit failed', error));
        } else {
            this._caffeine.release().catch(error =>
                this._context.logger.error('caffeine release failed', error));
        }
    }

    _applyWindowControls() {
        if (!this._wmPreferences || this._buttonLayoutSnapshot === null)
            return;
        if (this._settings.get_boolean('desktop-macos-controls'))
            this._wmPreferences.set_string(BUTTON_LAYOUT_KEY,
                MACOS_BUTTON_LAYOUT);
        else
            restoreStringIfUnchanged(this._wmPreferences, BUTTON_LAYOUT_KEY,
                MACOS_BUTTON_LAYOUT, this._buttonLayoutSnapshot);
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

        if (this._notifications && this._notificationsSnapshot !== null) {
            try {
                restoreBooleanIfUnchanged(this._notifications,
                    NOTIFICATIONS_KEY, false, this._notificationsSnapshot);
            } catch {
                // Best-effort cleanup.
            }
        }

        if (this._wmPreferences && this._buttonLayoutSnapshot !== null) {
            try {
                restoreStringIfUnchanged(this._wmPreferences,
                    BUTTON_LAYOUT_KEY, MACOS_BUTTON_LAYOUT,
                    this._buttonLayoutSnapshot);
            } catch {
                // Best-effort cleanup.
            }
        }

        this._caffeine?.release().catch(error =>
            this._context?.logger.error('caffeine release failed', error));

        if (this._ding && this._dingSnapshot) {
            try {
                restoreDing(this._ding, this._dingSnapshot);
            } catch {
                // Best-effort cleanup.
            }
        }

        this._desktopWindows = [];
        this._notifications = null;
        this._notificationsSnapshot = null;
        this._wmPreferences = null;
        this._buttonLayoutSnapshot = null;
        this._caffeine = null;
        this._context = null;
        this._ding = null;
        this._dingSnapshot = null;
    }

    disable() {
        this._teardown();
    }
}
