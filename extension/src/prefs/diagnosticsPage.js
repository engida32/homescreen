import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {parseDiagnostics} from './diagnosticsFormat.js';

function clearRows(group, rows) {
    for (const row of rows)
        group.remove(row);
    rows.length = 0;
}

function addRow(group, rows, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle});
    group.add(row);
    rows.push(row);
}

function formatTime(value) {
    const milliseconds = Number.isFinite(value) ? value : 0;
    const dateTime = GLib.DateTime.new_from_unix_local(
        Math.floor(milliseconds / 1000));
    return dateTime ? dateTime.format('%H:%M:%S') : '--:--:--';
}

export function buildDiagnosticsPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Diagnostics',
        icon_name: 'utilities-system-monitor-symbolic',
    });
    window.add(page);

    const statusGroup = new Adw.PreferencesGroup({title: 'Module status'});
    page.add(statusGroup);
    const statusRows = [];

    const resourceGroup = new Adw.PreferencesGroup({title: 'Resources'});
    page.add(resourceGroup);
    const resourceRows = [];

    const logGroup = new Adw.PreferencesGroup({title: 'Recent log'});
    page.add(logGroup);
    const logRows = [];

    const actionGroup = new Adw.PreferencesGroup();
    page.add(actionGroup);
    const refresh = new Adw.ActionRow({
        title: 'Refresh',
        subtitle: 'Ask the running extension for a fresh snapshot.',
    });
    const refreshButton = new Gtk.Button({
        label: 'Refresh',
        valign: Gtk.Align.CENTER,
    });
    refreshButton.connect('clicked', () => {
        settings.set_int('diagnostics-request',
            settings.get_int('diagnostics-request') + 1);
    });
    refresh.add_suffix(refreshButton);
    actionGroup.add(refresh);

    const render = () => {
        const data = parseDiagnostics(settings.get_string('diagnostics-json'));

        clearRows(statusGroup, statusRows);
        const modules = Object.entries(data.modules);
        if (modules.length === 0) {
            addRow(statusGroup, statusRows, 'No module status yet',
                'The extension has not written a snapshot.');
        } else {
            for (const [id, info] of modules) {
                const detail = info.detail ? `: ${info.detail}` : '';
                addRow(statusGroup, statusRows, id,
                    `${info.status ?? 'unknown'}${detail}`);
            }
        }

        clearRows(resourceGroup, resourceRows);
        const resources = Object.entries(data.resources);
        let totalSignals = 0;
        let totalSources = 0;
        for (const [id, counts] of resources) {
            totalSignals += counts.signals ?? 0;
            totalSources += counts.sources ?? 0;
            addRow(resourceGroup, resourceRows, id,
                `${counts.signals ?? 0} signals, ${counts.sources ?? 0} sources`);
        }
        addRow(resourceGroup, resourceRows, 'Total',
            `${totalSignals} signals, ${totalSources} sources`);

        clearRows(logGroup, logRows);
        const entries = [...data.log].reverse();
        if (entries.length === 0) {
            addRow(logGroup, logRows, 'No log entries', '');
        } else {
            for (const entry of entries) {
                const time = formatTime(entry.time);
                addRow(logGroup, logRows, entry.level ?? 'info',
                    `${time} ${entry.message ?? ''}`);
            }
        }
    };

    settings.connect('changed::diagnostics-json', render);
    render();
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        settings.set_int('diagnostics-request',
            settings.get_int('diagnostics-request') + 1);
        return GLib.SOURCE_REMOVE;
    });

    return page;
}
