import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {modeHides, rectsOverlap, shouldHidePanel, targetY} from './geometry.js';

const ACTION_MODE = Shell.ActionMode.NORMAL;

export class PanelModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._panelBox = null;
        this._baseY = 0;
        this._hidden = false;
        this._forcedHidden = false;
        this._animationActive = false;
        this._unredirectDisabled = false;
        this._pressure = null;
        this._barrier = null;
        this._hideTimeout = 0;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._panelBox = Main.layoutManager.panelBox;
        this._baseY = Main.layoutManager.primaryMonitor?.y ?? 0;

        this._panelBox.add_style_class_name('homescreen-panel');
        Main.layoutManager.removeChrome(this._panelBox);
        Main.layoutManager.addChrome(this._panelBox, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        this._scope.signal(Main.overview, 'showing', () => this._onOverview(true));
        this._scope.signal(Main.overview, 'hiding', () => this._onOverview(false));
        this._scope.signal(Main.layoutManager, 'monitors-changed', () => this._reposition());
        this._scope.signal(Main.panel, 'leave-event', () => this._scheduleHide());
        this._scope.signal(this._settings, 'changed::panel-mode', () => this._updateMode());
        this._scope.signal(this._settings, 'changed::panel-show-in-overview', () => this._updateMode());
        this._scope.signal(this._settings, 'changed::panel-show-fullscreen', () => this._updateMode());
        this._scope.signal(this._settings, 'changed::panel-hide-delay', () => this._scheduleHide());

        this._scope.timeout(100, () => {
            this._initPressureBarrier();
            this._updateMode();
            return GLib.SOURCE_REMOVE;
        });

        this._bindShortcut();
    }

    setForcedHidden(hidden) {
        this._forcedHidden = hidden;
        if (hidden)
            this._hide(false);
        else
            this._updateMode();
    }

    _bindShortcut() {
        Main.wm.addKeybinding(
            'panel-toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            ACTION_MODE,
            () => this._toggle()
        );
    }

    _toggle() {
        if (this._hidden)
            this._show(true);
        else
            this._hide(true);
    }

    _onOverview(showing) {
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
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window &&
                window.get_window_type() === Meta.WindowType.NORMAL &&
                !window.minimized &&
                window.get_monitor() === monitorIndex);

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

    _updateMode() {
        if (this._forcedHidden) {
            this._hide(true);
            return;
        }

        const mode = this._settings.get_string('panel-mode');
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
        if (this._hideTimeout)
            GLib.source_remove(this._hideTimeout);
        const delay = this._settings.get_int('panel-hide-delay');
        this._hideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._hideTimeout = 0;
            if (this._pointerInPanel() || Main.overview.visible)
                return GLib.SOURCE_REMOVE;
            if (Main.panel.menuManager.activeMenu)
                return GLib.SOURCE_REMOVE;
            this._updateMode();
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(animate) {
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
    }

    _hide(animate) {
        if (this._panelBox.menuManager?.activeMenu)
            return;
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

    _setUnredirectDisabled(disabled) {
        if (disabled === this._unredirectDisabled)
            return;
        if (disabled)
            global.compositor.disable_unredirect();
        else
            global.compositor.enable_unredirect();
        this._unredirectDisabled = disabled;
    }

    _initPressureBarrier() {
        this._destroyPressureBarrier();
        this._pressure = new Layout.PressureBarrier(
            this._settings.get_int('panel-reveal-pressure'),
            this._settings.get_int('panel-pressure-timeout'),
            ACTION_MODE
        );
        this._pressure.connect('trigger', () => {
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

    _destroyPressureBarrier() {
        if (this._pressure && this._barrier)
            this._pressure.removeBarrier(this._barrier);
        this._barrier?.destroy();
        this._barrier = null;
        this._pressure = null;
    }

    disable() {
        if (this._hideTimeout) {
            GLib.source_remove(this._hideTimeout);
            this._hideTimeout = 0;
        }
        Main.wm.removeKeybinding('panel-toggle-shortcut');
        this._destroyPressureBarrier();
        this._panelBox.remove_style_class_name('homescreen-panel');
        this._setUnredirectDisabled(false);
        this._hidden = false;
        this._panelBox.remove_all_transitions();
        this._panelBox.show();
        this._panelBox.y = this._baseY;
        Main.layoutManager.removeChrome(this._panelBox);
        Main.layoutManager.addChrome(this._panelBox, {
            affectsStruts: true,
            trackFullscreen: true,
        });
    }
}
