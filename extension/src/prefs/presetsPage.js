import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    applyImport,
    applyPreset,
    builtinPresets,
    exportPayload,
    loadUserPresets,
    resetAll,
    saveUserPreset,
    validateImportPayload,
    writeUserPresets,
} from '../core/presets.js';

function setBanner(banner, title) {
    banner.title = title;
    banner.revealed = true;
}

function storedPresetError(settings) {
    try {
        const value = JSON.parse(settings.get_string('user-presets-json'));
        return Array.isArray(value)
            ? ''
            : 'Stored presets are not a list.';
    } catch {
        return 'Stored presets could not be read.';
    }
}

function chooseFile(parent, action, title, acceptLabel) {
    return new Promise(resolve => {
        const chooser = Gtk.FileChooserNative.new(
            title, parent, action, acceptLabel, 'Cancel');
        const filter = new Gtk.FileFilter();
        filter.set_name('JSON');
        filter.add_pattern('*.json');
        chooser.add_filter(filter);
        chooser.connect('response', (dialog, response) => {
            const file = response === Gtk.ResponseType.ACCEPT
                ? dialog.get_file()
                : null;
            dialog.destroy();
            resolve(file);
        });
        chooser.show();
    });
}

function exportSettings(parent, settings, banner) {
    chooseFile(parent, Gtk.FileChooserAction.SAVE,
        'Export Homescreen settings', 'Export').then(file => {
        if (!file)
            return;
        try {
            const text = `${JSON.stringify(exportPayload(settings), null, 2)}\n`;
            file.replace_contents(new TextEncoder().encode(text), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            setBanner(banner, `Exported settings to ${file.get_basename()}.`);
        } catch (error) {
            setBanner(banner, `Could not export: ${error.message}`);
        }
    });
}

function importSettings(parent, settings, banner, refresh) {
    chooseFile(parent, Gtk.FileChooserAction.OPEN,
        'Import Homescreen settings', 'Import').then(file => {
        if (!file)
            return;
        try {
            const [, bytes] = file.load_contents(null);
            if (bytes.length > 1024 * 1024)
                throw new Error('File is larger than 1 MiB');
            const payload = JSON.parse(new TextDecoder().decode(bytes));
            const validated = validateImportPayload(payload, settings);
            const result = applyImport(settings, validated);
            const skipped = new Set([
                ...validated.skipped,
                ...result.skipped,
            ]).size;
            setBanner(banner,
                `Imported ${result.applied} settings` +
                `${skipped ? `, skipped ${skipped}` : ''}` +
                `, ${result.importedPresets} presets.`);
            refresh();
        } catch (error) {
            setBanner(banner, `Could not import: ${error.message}`);
        }
    });
}

function confirmReset(parent, onConfirm) {
    const dialog = new Adw.MessageDialog({
        transient_for: parent,
        modal: true,
        heading: 'Reset all settings?',
        body: 'This restores every Homescreen setting to its default. User presets are kept.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('reset', 'Reset');
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.connect('response', (_dialog, response) => {
        if (response === 'reset')
            onConfirm();
        dialog.destroy();
    });
    dialog.present();
}

export function buildPresetsPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Presets',
        icon_name: 'document-save-symbolic',
    });
    window.add(page);

    const statusGroup = new Adw.PreferencesGroup({title: 'Status'});
    page.add(statusGroup);
    const banner = new Adw.Banner({revealed: false});
    statusGroup.add(banner);
    const presetError = storedPresetError(settings);
    if (presetError)
        setBanner(banner, presetError);

    const builtins = new Adw.PreferencesGroup({
        title: 'Built-in presets',
        description: 'Apply a complete configuration. Modules reload immediately.',
    });
    page.add(builtins);
    for (const preset of builtinPresets(settings)) {
        const row = new Adw.ActionRow({
            title: preset.name,
            subtitle: preset.description,
        });
        const button = new Gtk.Button({
            label: 'Apply',
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', () => {
            applyPreset(settings, preset);
            setBanner(banner, `Applied ${preset.name}.`);
        });
        row.add_suffix(button);
        builtins.add(row);
    }

    const users = new Adw.PreferencesGroup({
        title: 'User presets',
        description: 'Save the current settings, apply a saved preset, or delete one.',
    });
    page.add(users);

    const saveRow = new Adw.EntryRow({
        title: 'New preset name',
        show_apply_button: true,
    });
    users.add(saveRow);

    const userRows = [];
    const refreshUsers = () => {
        for (const row of userRows)
            users.remove(row);
        userRows.length = 0;

        for (const [index, preset] of loadUserPresets(settings).entries()) {
            const row = new Adw.ActionRow({title: preset.name});
            const applyButton = new Gtk.Button({
                label: 'Apply',
                valign: Gtk.Align.CENTER,
            });
            applyButton.connect('clicked', () => {
                applyPreset(settings, preset);
                setBanner(banner, `Applied ${preset.name}.`);
            });
            const deleteButton = new Gtk.Button({
                label: 'Delete',
                valign: Gtk.Align.CENTER,
            });
            deleteButton.add_css_class('destructive-action');
            deleteButton.connect('clicked', () => {
                const presets = loadUserPresets(settings);
                presets.splice(index, 1);
                writeUserPresets(settings, presets);
                refreshUsers();
                setBanner(banner, `Deleted ${preset.name}.`);
            });
            row.add_suffix(applyButton);
            row.add_suffix(deleteButton);
            users.add(row);
            userRows.push(row);
        }
    };

    saveRow.connect('apply', () => {
        try {
            saveUserPreset(settings, saveRow.text);
            saveRow.text = '';
            refreshUsers();
            setBanner(banner, 'Saved the current settings.');
        } catch (error) {
            setBanner(banner, error.message);
        }
    });

    refreshUsers();

    const transfer = new Adw.PreferencesGroup({title: 'Transfer'});
    page.add(transfer);
    const exportRow = new Adw.ActionRow({
        title: 'Export settings',
        subtitle: 'Write readable JSON with settings and user presets.',
    });
    const exportButton = new Gtk.Button({
        label: 'Export',
        valign: Gtk.Align.CENTER,
    });
    exportButton.connect('clicked', () =>
        exportSettings(window, settings, banner));
    exportRow.add_suffix(exportButton);
    transfer.add(exportRow);

    const importRow = new Adw.ActionRow({
        title: 'Import settings',
        subtitle: 'Replace settings from a JSON file. Unknown keys are skipped.',
    });
    const importButton = new Gtk.Button({
        label: 'Import',
        valign: Gtk.Align.CENTER,
    });
    importButton.connect('clicked', () =>
        importSettings(window, settings, banner, refreshUsers));
    importRow.add_suffix(importButton);
    transfer.add(importRow);

    const resetGroup = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(resetGroup);
    const reset = new Adw.ActionRow({
        title: 'Reset all settings',
        subtitle: 'Restore every Homescreen setting. User presets are kept.',
    });
    const resetButton = new Gtk.Button({
        label: 'Reset',
        valign: Gtk.Align.CENTER,
    });
    resetButton.add_css_class('destructive-action');
    resetButton.connect('clicked', () => confirmReset(window, () => {
        resetAll(settings);
        refreshUsers();
        setBanner(banner, 'Reset all settings.');
    }));
    reset.add_suffix(resetButton);
    resetGroup.add(reset);

    return page;
}
