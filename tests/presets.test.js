import Gio from 'gi://Gio';

import {assert, assertEqual} from './helpers.js';
import {
    INTERNAL_KEYS,
    MODULE_KEYS,
    applyImport,
    applyPreset,
    builtinPresets,
    exportPayload,
    loadUserPresets,
    resetAll,
    resetModule,
    saveUserPreset,
    snapshotSettings,
    validateImportPayload,
    writeUserPresets,
} from '../extension/src/core/presets.js';

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
if (!schema)
    throw new Error('schema not compiled; run make schemas first');
const settings = new Gio.Settings({settings_schema: schema});

function resetSettings() {
    for (const key of settings.list_keys())
        settings.reset(key);
}

function userKeys() {
    return settings.list_keys().filter(key => !INTERNAL_KEYS.has(key)).sort();
}

resetSettings();

const moduleKeys = [...new Set(Object.values(MODULE_KEYS).flat())].sort();
assertEqual(moduleKeys.join(','), userKeys().join(','),
    'module keys cover every user-facing key');

const presets = builtinPresets(settings);
assertEqual(presets.length, 5, 'five built-in presets');
for (const preset of presets) {
    assertEqual(Object.keys(preset.settings).sort().join(','),
        userKeys().join(','), `${preset.id} covers every user key`);
}

const sonoma = presets.find(preset => preset.id === 'sonoma');
assert(sonoma, 'sonoma preset exists');
settings.set_int('reload-request', 0);
const applied = applyPreset(settings, sonoma);
assertEqual(settings.get_boolean('visual-enabled'), true, 'sonoma blur');
assertEqual(settings.get_boolean('desktop-macos-controls'), true, 'sonoma controls');
assertEqual(settings.get_int('reload-request'), 1, 'preset bumps reload');
assert(applied.applied > 0, 'preset applies settings');
assertEqual(applied.skipped.length, 0, 'preset skips nothing');

resetSettings();
const snapshot = snapshotSettings(settings);
assertEqual('diagnostics-json' in snapshot, false, 'snapshot excludes diagnostics');
assertEqual('reload-request' in snapshot, false, 'snapshot excludes reload');
assertEqual('user-presets-json' in snapshot, false, 'snapshot excludes user presets');

writeUserPresets(settings, [{name: 'Saved', settings: {'panel-mode': 'always'}}]);
settings.set_string('user-presets-json', '[{"name":"Bad"}]');
assertEqual(loadUserPresets(settings).length, 0, 'invalid preset filtered');
writeUserPresets(settings, [{name: 'Saved', settings: {'panel-mode': 'always'}}]);
const payload = exportPayload(settings);
assertEqual(payload.version, 1, 'export version');
assertEqual(payload.userPresets[0].name, 'Saved', 'export user preset');
assertEqual(validateImportPayload(payload, settings).skipped.length, 0, 'round trip validates');

const bad = {
    version: 1,
    settings: {
        'panel-mode': 'always',
        'dock-icon-size': 'not-an-integer',
        'no-such-key': true,
    },
};
const validatedBad = validateImportPayload(bad, settings);
assertEqual(validatedBad.settings['panel-mode'], 'always', 'valid import value kept');
assertEqual(validatedBad.skipped.includes('dock-icon-size'), true, 'wrong type skipped');
assertEqual(validatedBad.skipped.includes('no-such-key'), true, 'unknown key skipped');
const outOfRange = validateImportPayload({
    version: 1,
    settings: {'dock-radius': 999},
}, settings);
assertEqual(outOfRange.skipped.includes('dock-radius'), true, 'out of range skipped');
const fractional = validateImportPayload({
    version: 1,
    settings: {'dock-radius': 28.5},
}, settings);
assertEqual(fractional.skipped.includes('dock-radius'), true, 'fractional integer skipped');

let rejectedVersion = false;
try {
    validateImportPayload({version: 2, settings: {}}, settings);
} catch {
    rejectedVersion = true;
}
assert(rejectedVersion, 'unsupported version rejected');

resetSettings();
writeUserPresets(settings, [{name: 'Keep', settings: {'panel-mode': 'always'}}]);
const withoutPresets = validateImportPayload({
    version: 1,
    settings: {'panel-mode': 'autohide'},
}, settings);
applyImport(settings, withoutPresets);
assertEqual(loadUserPresets(settings)[0].name, 'Keep', 'import preserves presets');

const withPresets = validateImportPayload({
    version: 1,
    settings: {'panel-mode': 'always'},
    userPresets: [{name: 'Replace', settings: {'panel-mode': 'always'}}],
}, settings);
applyImport(settings, withPresets);
assertEqual(loadUserPresets(settings)[0].name, 'Replace', 'import replaces presets');

resetSettings();
settings.set_string('panel-mode', 'always');
settings.set_string('dock-position', 'left');
settings.set_int('reload-request', 0);
resetModule(settings, 'panel');
assertEqual(settings.get_string('panel-mode'), 'autohide', 'module reset panel');
assertEqual(settings.get_string('dock-position'), 'left', 'module reset leaves dock');
assertEqual(settings.get_int('reload-request'), 1, 'module reset bumps reload');

writeUserPresets(settings, [{name: 'Keep', settings: {}}]);
settings.set_string('dock-position', 'left');
settings.set_int('reload-request', 0);
resetAll(settings);
assertEqual(settings.get_string('dock-position'), 'bottom', 'full reset restores dock');
assertEqual(loadUserPresets(settings)[0].name, 'Keep', 'full reset keeps presets');
assertEqual(settings.get_int('reload-request'), 1, 'full reset bumps reload');

const saved = saveUserPreset(settings, '  Current  ');
assertEqual(saved[saved.length - 1].name, 'Current', 'save trims name');

print('preset tests passed');
