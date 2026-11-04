import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    formatBytes,
    formatPercent,
    formatRate,
    formatTemperature,
    sparklinePoints,
} from './monitorData.js';
import {MonitorSampler} from './monitorSampler.js';

const ROLE = 'homescreen-monitor';
const HISTORY_LENGTH = 30;

function readText(path, cancellable = null) {
    return new Promise((resolve, reject) => {
        const file = Gio.File.new_for_path(path);
        file.load_contents_async(cancellable, (source, result) => {
            try {
                const [ok, contents] = source.load_contents_finish(result);
                if (!ok) {
                    reject(new Error(`could not read ${path}`));
                    return;
                }
                resolve(new TextDecoder('utf-8').decode(contents));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function queryDisk(path, cancellable = null) {
    return new Promise((resolve, reject) => {
        const file = Gio.File.new_for_path(path);
        file.query_filesystem_info_async(
            'filesystem::size,filesystem::free',
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (source, result) => {
                try {
                    const info = source.query_filesystem_info_finish(result);
                    resolve({
                        size: info.get_attribute_uint64('filesystem::size'),
                        free: info.get_attribute_uint64('filesystem::free'),
                    });
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

export class MonitorModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._context = null;
        this._button = null;
        this._label = null;
        this._area = null;
        this._rows = null;
        this._sampler = null;
        this._history = [];
        this._timer = 0;
        this._active = false;
        this._sampling = false;
        this._generation = 0;
        this._cancellable = null;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._context = context;

        this._button = new PanelMenu.Button(0.0, 'Homescreen monitor');
        this._label = new St.Label({
            text: 'CPU —',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'homescreen-monitor-label',
        });
        this._area = new St.DrawingArea({
            style_class: 'homescreen-monitor-sparkline',
            width: 64,
            height: 18,
        });
        this._area.connect('repaint', area => this._drawSparkline(area));

        const box = new St.BoxLayout({
            style_class: 'homescreen-monitor-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);
        box.add_child(this._area);
        this._button.add_child(box);

        this._rows = {
            cpu: new PopupMenu.PopupMenuItem('CPU: —'),
            memory: new PopupMenu.PopupMenuItem('Memory: —'),
            disk: new PopupMenu.PopupMenuItem('Disk: —'),
            network: new PopupMenu.PopupMenuItem('Network: —'),
            temperature: new PopupMenu.PopupMenuItem('Temperature: —'),
        };
        for (const row of Object.values(this._rows))
            this._button.menu.addMenuItem(row);

        this._sampler = new MonitorSampler({
            readFile: readText,
            queryDisk,
            now: () => GLib.get_monotonic_time() / 1_000_000,
        });

        try {
            Main.panel.addToStatusArea(ROLE, this._button, 0, 'right');
        } catch (error) {
            this._button.destroy();
            this._button = null;
            throw error;
        }

        this._scope.signal(this._settings, 'changed::monitor-interval',
            () => this._restartTimer());
        for (const key of [
            'monitor-show-memory',
            'monitor-show-disk',
            'monitor-show-network',
            'monitor-show-temperature',
        ]) {
            this._scope.signal(this._settings, `changed::${key}`,
                () => this._syncVisibility());
        }

        this._syncVisibility();
        this._active = true;
        this._generation++;
        this._cancellable = new Gio.Cancellable();
        this._sample();
        this._restartTimer();
    }

    _restartTimer() {
        if (!this._active)
            return;
        if (this._timer)
            this._scope.removeSource(this._timer);

        const interval = this._settings.get_int('monitor-interval') * 1000;
        this._timer = this._scope.timeout(interval, () => {
            if (!this._active)
                return GLib.SOURCE_REMOVE;
            this._sample();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _sample() {
        if (!this._active || this._sampling || !this._sampler)
            return;

        const generation = this._generation;
        this._sampling = true;
        try {
            const sample = await this._sampler.sample(this._cancellable);
            if (!this._active || generation !== this._generation)
                return;
            this._render(sample);
        } catch (error) {
            this._context?.logger.error('monitor sample failed', error);
        } finally {
            if (generation === this._generation)
                this._sampling = false;
        }
    }

    _render(sample) {
        const cpu = formatPercent(sample.cpu.percent);
        this._label.text = `CPU ${cpu}`;

        if (Number.isFinite(sample.cpu.percent)) {
            this._history.push(sample.cpu.percent);
            if (this._history.length > HISTORY_LENGTH)
                this._history.shift();
        }
        this._area.queue_repaint();

        this._rows.cpu.label.text = `CPU: ${cpu}`;
        this._rows.memory.label.text = sample.memory
            ? `Memory: ${formatBytes(sample.memory.usedBytes)} / ` +
              `${formatBytes(sample.memory.totalBytes)} ` +
              `(${formatPercent(sample.memory.percent)})`
            : 'Memory: —';
        this._rows.disk.label.text = sample.disk
            ? `Disk: ${formatBytes(sample.disk.usedBytes)} / ` +
              `${formatBytes(sample.disk.totalBytes)} ` +
              `(${formatPercent(sample.disk.percent)})`
            : 'Disk: —';
        this._rows.network.label.text = sample.network
            ? `Network: ↓ ${formatRate(sample.network.rxPerSecond)} ` +
              `↑ ${formatRate(sample.network.txPerSecond)}`
            : 'Network: —';
        this._rows.temperature.label.text = sample.temperature === null
            ? 'Temperature: —'
            : `Temperature: ${formatTemperature(sample.temperature)}`;

        this._syncVisibility();
    }

    _syncVisibility() {
        if (!this._rows)
            return;

        this._rows.cpu.visible = true;
        this._rows.memory.visible = this._settings.get_boolean('monitor-show-memory');
        this._rows.disk.visible = this._settings.get_boolean('monitor-show-disk');
        this._rows.network.visible = this._settings.get_boolean('monitor-show-network');
        this._rows.temperature.visible =
            this._settings.get_boolean('monitor-show-temperature');
    }

    _drawSparkline(area) {
        const [width, height] = area.get_surface_size();
        const cr = area.get_context();
        try {
            const points = sparklinePoints(this._history, width, height, 0, 100);
            if (points.length < 2)
                return;

            cr.setLineWidth(1.5);
            cr.setSourceRGBA(0.35, 0.78, 1.0, 0.95);
            cr.moveTo(points[0][0], points[0][1]);
            for (const [x, y] of points.slice(1))
                cr.lineTo(x, y);
            cr.stroke();
        } finally {
            cr.$dispose();
        }
    }

    disable() {
        this._active = false;
        this._generation++;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timer && this._scope)
            this._scope.removeSource(this._timer);
        this._timer = 0;
        this._sampling = false;
        this._button?.destroy();
        this._button = null;
        this._label = null;
        this._area = null;
        this._rows = null;
        this._sampler = null;
        this._history = [];
        this._context = null;
        this._settings = null;
        this._scope = null;
    }
}
