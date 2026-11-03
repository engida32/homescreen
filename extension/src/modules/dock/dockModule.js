import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HomescreenDockIcon} from './dockIcon.js';
import {dockBackgroundStyle} from './dockStyle.js';
import {
    dockHeight,
    dockOrigin,
    dockWidth,
    hiddenDockY,
    rectsOverlap,
    slotCenter,
} from './layout.js';
import {scalesForCenters} from './magnification.js';
import {shouldShowDock} from './visibility.js';

const WINDOW_SIGNALS = [
    'position-changed',
    'size-changed',
    'notify::minimized',
    'notify::maximized-horizontally',
    'notify::maximized-vertically',
    'workspace-changed',
];

export class DockModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._container = null;
        this._background = null;
        this._box = null;
        this._icons = [];
        this._rebuildSource = 0;
        this._hideSource = 0;
        this._forcedHidden = false;
        this._overviewVisible = false;
        this._menuOpen = false;
        this._windowSignals = new Map();
        this._iconMenuSignals = new Map();
        this._shownY = 0;
        this._hiddenY = 0;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._overviewVisible = Main.overview.visible;

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

        try {
            const appSystem = Shell.AppSystem.get_default();
            const favorites = AppFavorites.getAppFavorites();
            this._scope.signal(appSystem, 'installed-changed', () => this._queueRebuild());
            this._scope.signal(appSystem, 'app-state-changed', () => this._queueRebuild());
            this._scope.signal(favorites, 'changed', () => this._queueRebuild());
            this._scope.signal(this._settings, 'changed::dock-icon-size', () => this._rebuild());
            this._scope.signal(this._settings, 'changed::dock-spacing', () => this._rebuild());
            this._scope.signal(this._settings, 'changed::dock-padding', () => this._rebuild());
            this._scope.signal(this._settings, 'changed::dock-margin', () => this._position());
            this._scope.signal(this._settings, 'changed::dock-radius', () => this._position());
            this._scope.signal(this._settings, 'changed::dock-opacity', () => this._position());

            this._scope.signal(Main.overview, 'showing', () => {
                this._overviewVisible = true;
                this._updateDockVisibility();
            });
            this._scope.signal(Main.overview, 'hiding', () => {
                this._overviewVisible = false;
                this._updateDockVisibility();
            });
            this._scope.signal(Main.layoutManager, 'monitors-changed', () => this._position());
            this._scope.signal(global.stage, 'motion-event', () => this._onStageMotion());
            this._scope.signal(this._settings, 'changed::dock-autohide', () => this._updateDockVisibility());
            this._scope.signal(this._settings, 'changed::dock-intellihide', () => this._updateDockVisibility());
            this._scope.signal(this._settings, 'changed::dock-magnification', () => this._updateMagnification());
            this._scope.signal(this._settings, 'changed::dock-magnification-strength', () => this._updateMagnification());
            this._scope.signal(this._container, 'enter-event', () => {
                this._showDock(true);
                return Clutter.EVENT_PROPAGATE;
            });
            this._scope.signal(this._container, 'leave-event', () => {
                this._resetMagnification();
                this._scheduleDockHide();
                return Clutter.EVENT_PROPAGATE;
            });
            this._scope.signal(this._container, 'motion-event', () => {
                this._updateMagnification();
                return Clutter.EVENT_PROPAGATE;
            });

            this._scope.signal(global.display, 'window-created', (_display, window) => {
                this._trackWindow(window);
                this._onWindowChanged();
            });
            this._scope.signal(global.display, 'restacked', () => {
                this._syncWindowSignals();
                this._onWindowChanged();
            });
            this._scope.signal(global.display, 'notify::focus-window', () => this._onWindowChanged());
            this._scope.signal(global.display, 'window-entered-monitor', () => {
                this._syncWindowSignals();
                this._onWindowChanged();
            });
            this._scope.signal(global.display, 'window-left-monitor', () => {
                this._syncWindowSignals();
                this._onWindowChanged();
            });
            this._scope.signal(global.workspace_manager, 'active-workspace-changed', () => {
                this._syncWindowSignals();
                this._onWindowChanged();
            });
            this._syncWindowSignals();

            this._rebuild();
        } catch (error) {
            this._destroyActors();
            throw error;
        }
    }

    setForcedHidden(hidden) {
        this._forcedHidden = hidden;
        if (!this._container)
            return;
        if (hidden)
            this._hideDock(false);
        else
            this._updateDockVisibility();
    }

    _isPointerAtEdge() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const [x, y] = global.get_pointer();
        return x >= monitor.x &&
            x < monitor.x + monitor.width &&
            y >= monitor.y + monitor.height - 2;
    }

    _isPointerOverDock() {
        if (!this._container)
            return false;
        const [x, y] = global.get_pointer();
        return x >= this._container.x &&
            x < this._container.x + this._container.width &&
            y >= this._container.y &&
            y < this._container.y + this._container.height;
    }

    _windowsOverlapDock() {
        if (!this._container || !this._settings.get_boolean('dock-intellihide'))
            return false;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const monitorIndex = Main.layoutManager.primaryIndex;
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const rect = {
            x: this._container.x,
            y: this._shownY,
            width: this._container.width,
            height: this._container.height,
        };
        return global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window &&
                window.get_window_type() === Meta.WindowType.NORMAL &&
                !window.minimized &&
                window.get_monitor() === monitorIndex &&
                (window.is_on_all_workspaces() ||
                    window.located_on_workspace(activeWorkspace)))
            .some(window => {
                const frame = window.get_frame_rect();
                return rectsOverlap(rect, {
                    x: frame.x,
                    y: frame.y,
                    width: frame.width,
                    height: frame.height,
                });
            });
    }

    _shouldStayShown() {
        if (!this._container)
            return false;
        return shouldShowDock({
            forcedHidden: this._forcedHidden,
            hasIcons: this._icons.length > 0,
            overviewVisible: this._overviewVisible,
            pointerAtEdge: this._isPointerAtEdge(),
            pointerOverDock: this._isPointerOverDock(),
            menuOpen: this._menuOpen,
            intellihide: this._settings.get_boolean('dock-intellihide'),
            overlaps: this._windowsOverlapDock(),
            autohide: this._settings.get_boolean('dock-autohide'),
        });
    }

    _cancelHide() {
        if (!this._hideSource)
            return;
        this._scope?.removeSource(this._hideSource);
        this._hideSource = 0;
    }

    _showDock(animate = true) {
        if (!this._container || this._forcedHidden || this._icons.length === 0)
            return;
        this._cancelHide();
        if (this._container.visible && this._container.y === this._shownY)
            return;
        this._container.remove_all_transitions();
        this._container.show();
        if (!animate) {
            this._container.set_position(this._container.x, this._shownY);
            return;
        }
        this._container.ease({
            y: this._shownY,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideDock(animate = true) {
        if (!this._container)
            return;
        this._cancelHide();
        if (!this._container.visible && this._container.y === this._hiddenY)
            return;
        this._container.remove_all_transitions();
        if (!animate) {
            this._container.set_position(this._container.x, this._hiddenY);
            this._container.hide();
            return;
        }
        this._container.ease({
            y: this._hiddenY,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._container && this._container.y === this._hiddenY)
                    this._container.hide();
            },
        });
    }

    _scheduleDockHide() {
        if (this._hideSource)
            return;
        if (!this._container || this._forcedHidden ||
            this._overviewVisible || this._icons.length === 0)
            return;
        const delay = this._settings.get_int('dock-hide-delay');
        this._hideSource = this._scope.timeout(delay, () => {
            this._hideSource = 0;
            if (!this._shouldStayShown())
                this._hideDock(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _onStageMotion() {
        if (!this._container)
            return Clutter.EVENT_PROPAGATE;
        this._updateMagnification();
        if (this._forcedHidden || this._overviewVisible ||
            this._icons.length === 0)
            return Clutter.EVENT_PROPAGATE;
        if (this._isPointerAtEdge() || this._isPointerOverDock()) {
            this._showDock(true);
            return Clutter.EVENT_PROPAGATE;
        }
        if (this._container.visible) {
            if (this._shouldStayShown())
                this._cancelHide();
            else
                this._scheduleDockHide();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _updateDockVisibility() {
        if (!this._container)
            return;
        if (this._shouldStayShown())
            this._showDock(false);
        else
            this._hideDock(false);
    }

    _onWindowChanged() {
        if (this._settings.get_boolean('dock-intellihide'))
            this._updateDockVisibility();
    }

    _trackWindow(window) {
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        if (this._windowSignals.has(window))
            return;

        const ids = WINDOW_SIGNALS.map(signal =>
            this._scope.signal(window, signal, () => this._onWindowChanged()));
        ids.push(this._scope.signal(window, 'unmanaged', () => {
            this._untrackWindow(window);
            this._onWindowChanged();
        }));
        this._windowSignals.set(window, ids);
    }

    _untrackWindow(window) {
        const ids = this._windowSignals.get(window);
        if (!ids)
            return;
        this._windowSignals.delete(window);
        for (const id of ids)
            this._scope.disconnect(id);
    }

    _syncWindowSignals() {
        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            if (window)
                this._trackWindow(window);
        }
    }

    _untrackAllWindows() {
        for (const window of [...this._windowSignals.keys()])
            this._untrackWindow(window);
    }

    _resetMagnification() {
        for (const icon of this._icons) {
            icon.remove_all_transitions();
            icon.set_pivot_point(0.5, 1.0);
            icon.set_scale(1, 1);
        }
    }

    _updateMagnification() {
        if (!this._container ||
            !this._container.visible ||
            this._forcedHidden ||
            !this._settings.get_boolean('dock-magnification') ||
            this._icons.length === 0 ||
            !this._isPointerOverDock()) {
            this._resetMagnification();
            return;
        }
        const [pointerX] = global.get_pointer();
        const localX = pointerX - this._container.x;
        const iconSize = this._settings.get_int('dock-icon-size');
        const spacing = this._settings.get_int('dock-spacing');
        const padding = this._settings.get_int('dock-padding');
        const centers = this._icons.map((_icon, index) =>
            slotCenter(index, iconSize, spacing, padding));
        const scales = scalesForCenters(
            localX,
            centers,
            iconSize + spacing,
            this._settings.get_double('dock-magnification-strength'),
            1.4
        );
        this._icons.forEach((icon, index) => {
            icon.set_pivot_point(0.5, 1.0);
            icon.set_scale(scales[index], scales[index]);
        });
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
        for (const icon of this._icons) {
            this._disconnectIconMenu(icon);
            icon.destroy();
        }
        this._icons = [];
        this._menuOpen = false;

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

    _disconnectIconMenu(icon) {
        const id = this._iconMenuSignals.get(icon);
        if (!id)
            return;
        this._iconMenuSignals.delete(icon);
        this._scope?.disconnect(id);
    }

    _resetIconMenus() {
        for (const icon of [...this._iconMenuSignals.keys()])
            this._disconnectIconMenu(icon);
        this._menuOpen = false;
    }

    _makeIcon(app) {
        const icon = new HomescreenDockIcon(app);
        icon.set_style('padding: 0;');
        icon.icon.setIconSize(this._settings.get_int('dock-icon-size'));
        const menuId = this._scope.signal(icon, 'menu-state-changed', (_icon, open) => {
            this._menuOpen = open;
            if (open) {
                this._cancelHide();
                return;
            }
            this._updateDockVisibility();
        });
        this._iconMenuSignals.set(icon, menuId);
        this._box.add_child(icon);
        return icon;
    }

    _position() {
        if (!this._container)
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
        this._hiddenY = hiddenDockY(monitor, margin);
        this._box.set_style(`spacing: ${spacing}px; padding: ${padding}px;`);
        this._background.set_style(dockBackgroundStyle(this._settings.get_int('dock-radius'), this._settings.get_double('dock-opacity')));
        this._container.set_size(width, height);
        const shown = this._shouldStayShown();
        this._container.set_position(origin.x, shown ? this._shownY : this._hiddenY);
        this._container.visible = shown;
        this._updateDockVisibility();
    }

    _destroyActors() {
        this._untrackAllWindows();
        this._resetIconMenus();
        for (const icon of this._icons)
            icon.destroy();
        this._icons = [];
        if (this._rebuildSource) {
            this._scope?.removeSource(this._rebuildSource);
            this._rebuildSource = 0;
        }
        this._cancelHide();
        this._overviewVisible = false;
        this._forcedHidden = false;
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
        }
        this._container = null;
        this._background = null;
        this._box = null;
    }

    disable() {
        this._destroyActors();
    }
}
