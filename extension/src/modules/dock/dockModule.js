import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HomescreenDockIcon} from './dockIcon.js';
import {dockHeight, dockOrigin, dockWidth} from './layout.js';

export class DockModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._container = null;
        this._background = null;
        this._box = null;
        this._icons = [];
        this._rebuildSource = 0;
        this._forcedHidden = false;
        this._shownY = 0;
        this._hiddenY = 0;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;

        this._container = new St.Widget({
            name: 'homescreen-dock',
            style_class: 'homescreen-dock',
            reactive: true,
            track_hover: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._background = new St.Widget({
            style_class: 'homescreen-dock-background',
            x_expand: true,
            y_expand: true,
        });
        this._box = new St.BoxLayout({
            style_class: 'homescreen-dock-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });

        this._container.add_child(this._background);
        this._container.add_child(this._box);
        Main.layoutManager.addChrome(this._container, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        const appSystem = Shell.AppSystem.get_default();
        const favorites = AppFavorites.getAppFavorites();
        this._scope.signal(appSystem, 'installed-changed', () => this._queueRebuild());
        this._scope.signal(appSystem, 'app-state-changed', () => this._queueRebuild());
        this._scope.signal(favorites, 'changed', () => this._queueRebuild());
        this._scope.signal(this._settings, 'changed::dock-icon-size', () => this._rebuild());
        this._scope.signal(this._settings, 'changed::dock-spacing', () => this._rebuild());
        this._scope.signal(this._settings, 'changed::dock-padding', () => this._rebuild());
        this._scope.signal(this._settings, 'changed::dock-margin', () => this._position());

        this._rebuild();
    }

    setForcedHidden(hidden) {
        this._forcedHidden = hidden;
        this._container.visible = !hidden;
    }

    _queueRebuild() {
        if (this._rebuildSource)
            return;
        this._rebuildSource = this._scope.timeout(50, () => {
            this._rebuildSource = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        for (const icon of this._icons)
            icon.destroy();
        this._icons = [];

        const appSystem = Shell.AppSystem.get_default();
        const favorites = AppFavorites.getAppFavorites();
        const pinned = favorites.getFavorites();
        const pinnedSet = new Set(pinned.map(app => app.get_id()));
        const running = appSystem.get_running()
            .filter(app => !pinnedSet.has(app.get_id()));

        for (const app of [...pinned, ...running])
            this._icons.push(this._makeIcon(app));

        this._position();
    }

    _makeIcon(app) {
        const icon = new HomescreenDockIcon(app);
        icon.icon.setIconSize(this._settings.get_int('dock-icon-size'));
        this._box.add_child(icon);
        return icon;
    }

    _position() {
        if (!this._container || this._icons.length === 0)
            return;

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const iconSize = this._settings.get_int('dock-icon-size');
        const spacing = this._settings.get_int('dock-spacing');
        const padding = this._settings.get_int('dock-padding');
        const margin = this._settings.get_int('dock-margin');
        const width = dockWidth(this._icons.length, iconSize, spacing, padding);
        const height = dockHeight(iconSize, padding);
        const origin = dockOrigin(monitor, width, height, margin);

        this._shownY = origin.y;
        this._hiddenY = monitor.y + monitor.height - 2;
        this._box.set_style(`spacing: ${spacing}px; padding: ${padding}px;`);
        this._container.set_size(width, height);
        this._container.set_position(origin.x, this._forcedHidden ? this._hiddenY : this._shownY);
        this._container.visible = !this._forcedHidden;
    }

    disable() {
        for (const icon of this._icons)
            icon.destroy();
        this._icons = [];
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
        }
        this._container = null;
        this._background = null;
        this._box = null;
    }
}
