import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {formatClock, formatDate, hasMessage} from './format.js';

export class LockscreenModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._dialog = null;
        this._clock = null;
        this._clockSignal = 0;
        this._message = null;
        this._wallpapers = [];
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;

        // GNOME Shell 50.1: ScreenShield emits lock-screen-shown after _dialog
        // exists. Verified in /usr/share/gnome-shell js/ui/screenShield.js.
        this._scope.signal(Main.screenShield, 'lock-screen-shown', () => this._apply());
        this._scope.signal(Main.screenShield, 'locked-changed', () => {
            if (!Main.screenShield.locked)
                this._restore();
        });
        this._scope.signal(Main.layoutManager, 'monitors-changed', () => this._applyWallpaper());

        this._scope.signal(this._settings, 'changed::lockscreen-clock-format', () => this._refreshClock());
        this._scope.signal(this._settings, 'changed::lockscreen-date-format', () => this._refreshClock());
        this._scope.signal(this._settings, 'changed::lockscreen-message', () => this._refreshMessage());
        this._scope.signal(this._settings, 'changed::lockscreen-wallpaper-uri', () => this._applyWallpaper());

        if (Main.screenShield?.locked)
            this._apply();
    }

    _apply() {
        // GNOME Shell 50.1: UnlockDialog exposes _clock, _time, _date, and
        // _backgroundGroup. Verified in js/ui/unlockDialog.js.
        const dialog = Main.screenShield?._dialog;
        if (!dialog || dialog === this._dialog)
            return;

        this._restore();
        this._dialog = dialog;
        this._dialog.add_style_class_name('homescreen-lockscreen');

        this._clock = this._dialog._clock ?? null;
        if (!this._clock) {
            this._restore();
            return;
        }

        this._clock.add_style_class_name('homescreen-lockscreen-clock');
        this._clock._time.add_style_class_name('homescreen-lockscreen-clock-time');
        this._clock._date.add_style_class_name('homescreen-lockscreen-clock-date');

        // GNOME Shell 50.1: UnlockDialogClock connects _updateClock to
        // _wallClock before we can wrap it, so listen to the wall clock too.
        this._clockSignal = this._scope.signal(
            this._clock._wallClock,
            'notify::clock',
            () => this._refreshClock());

        this._refreshClock();
        this._refreshMessage();
        this._applyWallpaper();
    }

    _refreshClock() {
        if (!this._clock)
            return;
        const now = GLib.DateTime.new_now_local();
        this._clock._time.text = formatClock(
            now,
            this._settings.get_string('lockscreen-clock-format'));
        this._clock._date.text = formatDate(
            now,
            this._settings.get_string('lockscreen-date-format'));
    }

    _refreshMessage() {
        if (!this._clock)
            return;
        const message = this._settings.get_string('lockscreen-message').trim();
        if (!hasMessage(message)) {
            this._message?.destroy();
            this._message = null;
            return;
        }
        if (!this._message) {
            this._message = new St.Label({
                style_class: 'homescreen-lockscreen-message',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._clock.insert_child_at_index(this._message, 2);
        }
        this._message.text = message;
    }

    _applyWallpaper() {
        this._clearWallpaper();
        const uri = this._settings.get_string('lockscreen-wallpaper-uri').trim();
        if (!uri || !this._dialog || !uri.startsWith('file://'))
            return;

        this._dialog._backgroundGroup.visible = false;
        for (const monitor of Main.layoutManager.monitors) {
            const widget = new St.Widget({
                style_class: 'homescreen-lockscreen-wallpaper',
                style: `background-image: url("${uri}");`,
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
            });
            this._dialog.insert_child_at_index(widget, 0);
            this._wallpapers.push(widget);
        }
    }

    _clearWallpaper() {
        for (const widget of this._wallpapers) {
            if (widget.get_parent())
                widget.destroy();
        }
        this._wallpapers = [];
        if (this._dialog?._backgroundGroup)
            this._dialog._backgroundGroup.visible = true;
    }

    _restore() {
        if (this._clockSignal) {
            this._scope?.disconnect(this._clockSignal);
            this._clockSignal = 0;
        }
        this._clearWallpaper();
        if (this._message) {
            this._message.destroy();
            this._message = null;
        }
        if (this._clock) {
            this._clock._time.remove_style_class_name('homescreen-lockscreen-clock-time');
            this._clock._date.remove_style_class_name('homescreen-lockscreen-clock-date');
            this._clock.remove_style_class_name('homescreen-lockscreen-clock');
        }
        if (this._dialog)
            this._dialog.remove_style_class_name('homescreen-lockscreen');
        this._dialog = null;
        this._clock = null;
    }

    disable() {
        this._restore();
    }
}
