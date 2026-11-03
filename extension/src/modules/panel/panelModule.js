import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {rectsOverlap, shouldHidePanel, targetY} from './geometry.js';

const ACTION_MODE = Shell.ActionMode.NORMAL;
const WINDOW_SIGNALS = [
    'position-changed',
    'size-changed',
    'notify::minimized',
    'notify::maximized-horizontally',
    'notify::maximized-vertically',
    'workspace-changed',
];

export class PanelModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._panelBox = null;
        this._baseY = 0;
        this._hidden = false;
        this._forcedHidden = false;
        this._unredirectDisabled = false;
        this._pressure = null;
        this._barrier = null;
        this._hideTimeout = 0;
        this._revealTimeout = 0;
        this._barrierRetry = 0;
        this._windowSignals = new Map();
        this._affectsStruts = false;
        this._keybindingBound = false;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;

        try {
            this._panelBox = Main.layoutManager.panelBox;
            this._baseY = Main.layoutManager.primaryMonitor?.y ?? 0;

            this._panelBox.add_style_class_name('homescreen-panel');
            Main.layoutManager.removeChrome(this._panelBox);
            Main.layoutManager.addChrome(this._panelBox, {
                affectsStruts: false,
                trackFullscreen: true,
            });
            this._affectsStruts = false;

            this._scope.signal(Main.overview, 'showing', () => this._onOverview(true));
            this._scope.signal(Main.overview, 'hiding', () => this._onOverview(false));
            this._scope.signal(Main.layoutManager, 'monitors-changed', () => this._reposition());
            this._scope.signal(Main.panel, 'leave-event', () => this._scheduleHide());
            this._scope.signal(this._settings, 'changed::panel-mode', () => this._updateMode());
            this._scope.signal(this._settings, 'changed::panel-show-in-overview', () => this._updateMode());
            this._scope.signal(this._settings, 'changed::panel-show-fullscreen', () => this._updateMode());
            this._scope.signal(this._settings, 'changed::panel-hide-delay', () => this._scheduleHide());

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

            this._scope.timeout(100, () => {
                this._initPressureBarrier();
                this._updateMode();
                return GLib.SOURCE_REMOVE;
            });

            this._bindShortcut();
        } catch (error) {
            this._rollbackEnable();
            throw error;
        }
    }

    setForcedHidden(hidden) {
        this._forcedHidden = hidden;
        if (hidden) {
            this._setAffectsStruts(false);
            this._hide(false);
        } else {
            this._updateMode();
        }
    }

    _bindShortcut() {
        Main.wm.addKeybinding(
            'panel-toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            ACTION_MODE,
            () => this._toggle()
        );
        this._keybindingBound = true;
    }

    _toggle() {
        if (this._forcedHidden)
            return;
        if (this._hidden)
            this._show(true);
        else
            this._hide(true);
    }

    _onOverview(showing) {
        if (this._forcedHidden) {
            this._hide(true);
            return;
        }
        if (showing && this._settings.get_boolean('panel-show-in-overview'))
            this._show(true);
        else
            this._updateMode();
    }

    _reposition() {
        this._baseY = Main.layoutManager.primaryMonitor?.y ?? 0;
        this._destroyPressureBarrier();
        this._initPressureBarrier();
        this._updateMode();
    }

    _panelRect() {
        return {
            x: this._panelBox.x,
            y: this._baseY,
            width: this._panelBox.width,
            height: this._panelBox.height,
        };
    }

    _windowOverlapsPanel() {
        const rect = this._panelRect();
        const monitorIndex = Main.layoutManager.primaryIndex;
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window &&
                window.get_window_type() === Meta.WindowType.NORMAL &&
                !window.minimized &&
                window.get_monitor() === monitorIndex &&
                (window.is_on_all_workspaces() ||
                    window.located_on_workspace(activeWorkspace)));

        return windows.some(window => {
            const frame = window.get_frame_rect();
            return rectsOverlap(rect, {
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height,
            });
        });
    }

    _pointerInPanel() {
        const [x, y] = global.get_pointer();
        const rect = this._panelRect();
        return x >= rect.x && x < rect.x + rect.width &&
            y >= rect.y && y < rect.y + rect.height;
    }

    _onWindowChanged() {
        if (this._settings.get_string('panel-mode') === 'intellihide')
            this._updateMode();
    }

    _updateMode() {
        const mode = this._settings.get_string('panel-mode');
        this._setAffectsStruts(!this._forcedHidden && mode === 'always');

        if (this._forcedHidden) {
            this._hide(true);
            return;
        }
        if (mode === 'always') {
            this._show(true);
            return;
        }
        if (mode === 'hidden') {
            this._hide(true);
            return;
        }

        const hide = shouldHidePanel({
            mode,
            forcedHidden: this._forcedHidden,
            overviewVisible: Main.overview.visible,
            showInOverview: this._settings.get_boolean('panel-show-in-overview'),
            overlaps: this._windowOverlapsPanel(),
            pointerInPanel: this._pointerInPanel(),
        });

        if (hide)
            this._hide(true);
        else
            this._show(true);
    }

    _scheduleHide() {
        this._cancelHide();
        if (this._hidden)
            return;
        const delay = this._settings.get_int('panel-hide-delay');
        this._hideTimeout = this._scope.timeout(delay, () => {
            if (this._pointerInPanel() || Main.overview.visible) {
                this._hideTimeout = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (Main.panel.menuManager?.activeMenu)
                return GLib.SOURCE_CONTINUE;
            this._hideTimeout = 0;
            this._updateMode();
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(animate) {
        if (this._forcedHidden)
            return;
        this._cancelHide();
        this._cancelReveal();
        if (!this._panelBox.visible)
            this._panelBox.show();
        this._setUnredirectDisabled(true);
        this._hidden = false;
        const duration = animate
            ? this._settings.get_double('panel-animation-time') * 1000
            : 0;
        this._panelBox.remove_all_transitions();
        this._panelBox.ease({
            y: targetY(this._baseY, this._panelBox.height, false),
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._setUnredirectDisabled(false),
        });

        const mode = this._settings.get_string('panel-mode');
        if (mode !== 'always' && !this._forcedHidden && !Main.overview.visible) {
            this._revealTimeout = this._scope.timeout(Math.round(duration), () => {
                this._revealTimeout = 0;
                this._scheduleHide();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _hide(animate) {
        if (!this._forcedHidden && Main.panel.menuManager?.activeMenu)
            return;
        this._cancelHide();
        this._cancelReveal();
        this._setUnredirectDisabled(false);
        this._hidden = true;
        const duration = animate
            ? this._settings.get_double('panel-animation-time') * 1000
            : 0;
        this._panelBox.remove_all_transitions();
        this._panelBox.ease({
            y: targetY(this._baseY, this._panelBox.height, true),
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._hidden)
                    this._panelBox.hide();
            },
        });
    }

    _cancelHide() {
        if (!this._hideTimeout)
            return;
        this._scope.removeSource(this._hideTimeout);
        this._hideTimeout = 0;
    }

    _cancelReveal() {
        if (!this._revealTimeout)
            return;
        this._scope.removeSource(this._revealTimeout);
        this._revealTimeout = 0;
    }

    _setAffectsStruts(enabled) {
        if (this._affectsStruts === enabled)
            return;
        Main.layoutManager.removeChrome(this._panelBox);
        Main.layoutManager.addChrome(this._panelBox, {
            affectsStruts: enabled,
            trackFullscreen: true,
        });
        this._affectsStruts = enabled;
    }

    _setUnredirectDisabled(disabled) {
        if (disabled === this._unredirectDisabled)
            return;
        if (disabled)
            global.compositor.disable_unredirect();
        else
            global.compositor.enable_unredirect();
        this._unredirectDisabled = disabled;
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

    _initPressureBarrier() {
        if (!this._panelBox ||
            this._panelBox.width <= 0 ||
            this._panelBox.height <= 0) {
            this._scheduleBarrierRetry();
            return;
        }

        this._cancelBarrierRetry();
        this._destroyPressureBarrier();
        this._pressure = new Layout.PressureBarrier(
            this._settings.get_int('panel-reveal-pressure'),
            this._settings.get_int('panel-pressure-timeout'),
            ACTION_MODE
        );
        this._pressure.connect('trigger', () => {
            if (this._forcedHidden)
                return;
            if (Main.layoutManager.primaryMonitor?.inFullscreen &&
                !this._settings.get_boolean('panel-show-fullscreen'))
                return;
            this._show(true);
        });
        this._barrier = new Meta.Barrier({
            backend: global.backend,
            x1: this._panelBox.x,
            x2: this._panelBox.x + this._panelBox.width,
            y1: this._baseY,
            y2: this._baseY,
            directions: Meta.BarrierDirection.POSITIVE_Y,
        });
        this._pressure.addBarrier(this._barrier);
    }

    _scheduleBarrierRetry() {
        if (this._barrierRetry)
            return;
        this._barrierRetry = this._scope.timeout(100, () => {
            this._barrierRetry = 0;
            this._initPressureBarrier();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelBarrierRetry() {
        if (!this._barrierRetry)
            return;
        this._scope.removeSource(this._barrierRetry);
        this._barrierRetry = 0;
    }

    _destroyPressureBarrier() {
        if (this._pressure && this._barrier)
            this._pressure.removeBarrier(this._barrier);
        this._barrier?.destroy();
        this._barrier = null;
        this._pressure = null;
    }

    _rollbackEnable() {
        try {
            this._cancelHide();
        } catch {
            // Best-effort cleanup.
        }
        try {
            this._cancelReveal();
        } catch {
            // Best-effort cleanup.
        }
        try {
            this._cancelBarrierRetry();
        } catch {
            // Best-effort cleanup.
        }
        try {
            this._destroyPressureBarrier();
        } catch {
            // Best-effort cleanup.
        }
        try {
            this._untrackAllWindows();
        } catch {
            // Best-effort cleanup.
        }
        if (this._keybindingBound) {
            try {
                Main.wm.removeKeybinding('panel-toggle-shortcut');
            } catch {
                // The binding may not have been registered.
            }
            this._keybindingBound = false;
        }
        try {
            this._setUnredirectDisabled(false);
        } catch {
            // Best-effort cleanup.
        }
        if (this._panelBox) {
            try {
                this._panelBox.remove_style_class_name('homescreen-panel');
            } catch {
                // The style may not have been added.
            }
            try {
                this._panelBox.remove_all_transitions();
                this._panelBox.show();
                this._panelBox.y = this._baseY;
            } catch {
                // Best-effort cleanup.
            }
            try {
                Main.layoutManager.removeChrome(this._panelBox);
                Main.layoutManager.addChrome(this._panelBox, {
                    affectsStruts: true,
                    trackFullscreen: true,
                });
            } catch {
                // Best-effort cleanup.
            }
            this._affectsStruts = true;
        }
        this._hidden = false;
        this._forcedHidden = false;
    }

    disable() {
        this._cancelHide();
        this._cancelReveal();
        this._cancelBarrierRetry();
        Main.wm.removeKeybinding('panel-toggle-shortcut');
        this._keybindingBound = false;
        this._destroyPressureBarrier();
        this._untrackAllWindows();
        this._panelBox.remove_style_class_name('homescreen-panel');
        this._setUnredirectDisabled(false);
        this._hidden = false;
        this._forcedHidden = false;
        this._panelBox.remove_all_transitions();
        this._panelBox.show();
        this._panelBox.y = this._baseY;
        Main.layoutManager.removeChrome(this._panelBox);
        Main.layoutManager.addChrome(this._panelBox, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this._affectsStruts = true;
    }
}
