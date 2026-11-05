# Phase 6: Presets, Diagnostics, and Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic presets, readable export/import, per-module and full reset, live diagnostics, workspace indicator, notification mute, Caffeine, macOS window controls, and packaging coverage.

**Architecture:** A pure `presets.js` module owns preset data, settings snapshots, import validation, reset key maps, and the reload counter. The extension restarts modules through a reload signal. Diagnostics uses a request/response pair through GSettings. New desktop behavior snapshots and restores external GSettings values. New preferences pages use the existing Adw page pattern.

**Tech Stack:** GJS, GNOME Shell 50.1, GSettings, GTK4/Adw, D-Bus SessionManager, GPLv3.

**Spec:** `docs/superpowers/specs/2026-11-05-phase-6-presets-diagnostics-design.md`

## Global Constraints

- GNOME Shell 50.1 on Wayland only. Metadata `shell-version` stays `["50"]`.
- UUID: `homescreen@engida32.github.io`. Schema: `org.gnome.shell.extensions.homescreen`.
- No synchronous file I/O or synchronous D-Bus on the Shell main loop.
- Preferences-process file I/O may be synchronous; it is a separate process.
- Every Shell signal, timeout, and actor is owned by a `ModuleScope` and released in `disable()`.
- Private Shell APIs need a comment naming GNOME Shell 50.1 and the verified file.
- External settings must restore only when the user has not changed them while enabled.
- `make check` must stay green after every task and end with `PROBE_OK`.

## Review Focus

- Malformed import JSON and wrong-typed values must not partially write settings.
- A reload must not leave duplicate scopes, duplicate panel buttons, or leaked signals.
- Invalid `diagnostics-json` must render an empty state, not throw in preferences.
- Disabling must remove the workspace indicator and release the Caffeine inhibitor.
- User changes to notification banners or button layout while enabled must not be overwritten on disable.

---

### Task 1: Schema Keys and Preset Core

**Files:**
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`
- Create: `extension/src/core/presets.js`
- Test: `tests/presets.test.js`

**Interfaces:**
- Consumes: `Gio.Settings` with the Homescreen schema.
- Produces: `INTERNAL_KEYS`, `BUILTIN_PRESETS`, `MODULE_KEYS`, `builtinPresets(settings)`, `snapshotSettings(settings)`, `applySettings(settings, values)`, `applyPreset(settings, preset)`, `loadUserPresets(settings)`, `writeUserPresets(settings, presets)`, `saveUserPreset(settings, name)`, `exportPayload(settings)`, `validateImportPayload(payload, settings)`, `applyImport(settings, validated)`, `resetModule(settings, moduleId)`, `resetAll(settings)`, `bumpReload(settings)`.

- [ ] **Step 1: Add the schema keys**

Add `panel-show-workspace-indicator` after `panel-toggle-shortcut`:

```xml
    <key name="panel-show-workspace-indicator" type="b">
      <default>false</default>
      <summary>Show the workspace indicator in the panel</summary>
    </key>
```

Add the desktop keys after `desktop-show-desktop-shortcut`:

```xml
    <key name="desktop-mute-notifications" type="b">
      <default>false</default>
      <summary>Mute notification banners while enabled</summary>
    </key>
    <key name="desktop-caffeine" type="b">
      <default>false</default>
      <summary>Inhibit idle and suspend while enabled</summary>
    </key>
    <key name="desktop-macos-controls" type="b">
      <default>false</default>
      <summary>Use macOS window button order</summary>
    </key>
```

Add the internal keys after `diagnostics-json`:

```xml
    <key name="user-presets-json" type="s">
      <default>'[]'</default>
      <summary>User presets as JSON</summary>
    </key>
    <key name="reload-request" type="i">
      <default>0</default>
      <summary>Internal module reload counter</summary>
    </key>
    <key name="diagnostics-request" type="i">
      <default>0</default>
      <summary>Internal diagnostics refresh counter</summary>
    </key>
```

- [ ] **Step 2: Write the failing preset test**

Create `tests/presets.test.js`:

```javascript
import Gio from 'gi://Gio';

import {assert, assertEqual} from './helpers.js';
import {
    INTERNAL_KEYS,
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
make schemas
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/presets.test.js
```

Expected: FAIL with a missing `presets.js` module.

- [ ] **Step 4: Implement `presets.js`**

Create `extension/src/core/presets.js`:

```javascript
import GLib from 'gi://GLib';

export const INTERNAL_KEYS = new Set([
    'diagnostics-json',
    'diagnostics-request',
    'reload-request',
    'user-presets-json',
]);

export const MODULE_KEYS = {
    panel: [
        'panel-enabled', 'panel-mode', 'panel-show-in-overview',
        'panel-show-fullscreen', 'panel-hide-delay', 'panel-reveal-pressure',
        'panel-pressure-timeout', 'panel-animation-time',
        'panel-toggle-shortcut', 'panel-show-workspace-indicator',
    ],
    dock: [
        'dock-enabled', 'dock-position', 'dock-icon-size', 'dock-spacing',
        'dock-padding', 'dock-margin', 'dock-radius', 'dock-opacity',
        'dock-autohide', 'dock-intellihide', 'dock-magnification',
        'dock-magnification-strength', 'dock-hide-delay',
    ],
    desktop: [
        'desktop-enabled', 'desktop-hide-icons', 'desktop-focus-mode',
        'desktop-show-desktop-shortcut', 'desktop-mute-notifications',
        'desktop-caffeine', 'desktop-macos-controls',
    ],
    lockscreen: [
        'lockscreen-enabled', 'lockscreen-clock-format',
        'lockscreen-date-format', 'lockscreen-message',
        'lockscreen-wallpaper-uri',
    ],
    visual: [
        'visual-enabled', 'visual-blur-panel', 'visual-blur-dock',
        'visual-blur-radius', 'visual-blur-brightness',
        'visual-blur-overview',
    ],
    tiling: [
        'tiling-enabled', 'tiling-gap', 'tiling-half-left-shortcut',
        'tiling-half-right-shortcut', 'tiling-half-top-shortcut',
        'tiling-half-bottom-shortcut', 'tiling-quarter-top-left-shortcut',
        'tiling-quarter-top-right-shortcut',
        'tiling-quarter-bottom-left-shortcut',
        'tiling-quarter-bottom-right-shortcut', 'tiling-full-shortcut',
    ],
    monitor: [
        'monitor-enabled', 'monitor-interval', 'monitor-show-memory',
        'monitor-show-disk', 'monitor-show-network',
        'monitor-show-temperature',
    ],
    'app-grid': [
        'app-grid-enabled', 'app-grid-alphabetical', 'app-grid-rows',
        'app-grid-columns', 'app-grid-icon-size', 'app-grid-show-labels',
        'app-grid-disable-remote-search', 'app-grid-launchpad',
    ],
};

export const BUILTIN_PRESETS = [
    {
        id: 'clean',
        name: 'Clean',
        description: 'Autohide panel and dock, hidden desktop icons, no heavy effects.',
        overrides: {},
    },
    {
        id: 'sonoma',
        name: 'Sonoma',
        description: 'Glass panel and dock, magnification, Launchpad grid, macOS controls.',
        overrides: {
            'visual-enabled': true,
            'visual-blur-panel': true,
            'visual-blur-dock': true,
            'visual-blur-overview': true,
            'dock-radius': 28,
            'lockscreen-enabled': true,
            'app-grid-enabled': true,
            'app-grid-launchpad': true,
            'desktop-macos-controls': true,
        },
    },
    {
        id: 'power',
        name: 'Power',
        description: 'Visible panel, workspace indicator, visible dock, monitor and tiling.',
        overrides: {
            'panel-mode': 'always',
            'panel-show-workspace-indicator': true,
            'dock-autohide': false,
            'dock-intellihide': false,
            'monitor-enabled': true,
            'tiling-enabled': true,
        },
    },
    {
        id: 'presentation',
        name: 'Presentation',
        description: 'Hidden panel and dock, muted notifications, Caffeine on.',
        overrides: {
            'panel-mode': 'hidden',
            'dock-enabled': false,
            'desktop-mute-notifications': true,
            'desktop-caffeine': true,
            'visual-enabled': false,
            'monitor-enabled': false,
            'tiling-enabled': false,
            'app-grid-enabled': false,
            'lockscreen-enabled': false,
        },
    },
    {
        id: 'minimal',
        name: 'Minimal',
        description: 'Visible panel, dock off, no effects, no monitor.',
        overrides: {
            'panel-mode': 'always',
            'dock-enabled': false,
            'desktop-hide-icons': true,
            'visual-enabled': false,
            'monitor-enabled': false,
            'tiling-enabled': false,
            'app-grid-enabled': false,
            'lockscreen-enabled': false,
        },
    },
];

function userFacingKeys(settings) {
    return settings.list_keys().filter(key => !INTERNAL_KEYS.has(key));
}

function variantFor(settings, key, value) {
    const type = settings.get_default_value(key).get_type_string();
    return new GLib.Variant(type, value);
}

function valueAllowed(settings, key, value) {
    const type = settings.get_default_value(key).get_type_string();
    if (type === 'b' && typeof value !== 'boolean')
        return false;
    if (type === 'i' && !Number.isInteger(value))
        return false;
    if (type === 'd' && typeof value !== 'number')
        return false;
    if (type === 's' && typeof value !== 'string')
        return false;
    if (type === 'as' && (!Array.isArray(value) ||
        value.some(item => typeof item !== 'string')))
        return false;

    const [kind, range] = settings.get_range(key).deepUnpack();
    if (kind === 'range') {
        const [min, max] = range.deepUnpack();
        return typeof value === 'number' && value >= min && value <= max;
    }
    if (kind === 'enum')
        return range.deepUnpack().includes(value);
    return true;
}

export function builtinPresets(settings) {
    const keys = userFacingKeys(settings);
    return BUILTIN_PRESETS.map(definition => {
        const values = {};
        for (const key of keys)
            values[key] = settings.get_default_value(key).deepUnpack();
        Object.assign(values, definition.overrides);
        return {
            id: definition.id,
            name: definition.name,
            description: definition.description,
            settings: values,
        };
    });
}

export function snapshotSettings(settings) {
    const values = {};
    for (const key of userFacingKeys(settings))
        values[key] = settings.get_value(key).deepUnpack();
    return values;
}

export function applySettings(settings, values) {
    const known = new Set(settings.list_keys());
    let applied = 0;
    const skipped = [];

    for (const [key, value] of Object.entries(values)) {
        if (INTERNAL_KEYS.has(key) || !known.has(key)) {
            skipped.push(key);
            continue;
        }
        if (!valueAllowed(settings, key, value)) {
            skipped.push(key);
            continue;
        }
        try {
            settings.set_value(key, variantFor(settings, key, value));
            applied++;
        } catch {
            skipped.push(key);
        }
    }

    return {applied, skipped};
}

export function bumpReload(settings) {
    settings.set_int('reload-request', settings.get_int('reload-request') + 1);
}

export function applyPreset(settings, preset) {
    const result = applySettings(settings, preset.settings);
    bumpReload(settings);
    return result;
}

export function loadUserPresets(settings) {
    try {
        const value = JSON.parse(settings.get_string('user-presets-json'));
        if (!Array.isArray(value))
            return [];
        return value.filter(preset => preset && typeof preset === 'object' &&
            !Array.isArray(preset) && typeof preset.name === 'string' &&
            preset.name.trim() && preset.settings &&
            typeof preset.settings === 'object' &&
            !Array.isArray(preset.settings));
    } catch {
        return [];
    }
}

export function writeUserPresets(settings, presets) {
    settings.set_string('user-presets-json', JSON.stringify(presets));
}

export function saveUserPreset(settings, name) {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed)
        throw new Error('Preset name is required');
    const presets = loadUserPresets(settings);
    presets.push({name: trimmed, settings: snapshotSettings(settings)});
    writeUserPresets(settings, presets);
    return presets;
}

export function exportPayload(settings) {
    return {
        version: 1,
        settings: snapshotSettings(settings),
        userPresets: loadUserPresets(settings),
    };
}

export function validateImportPayload(payload, settings) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Import must be a JSON object');
    if (payload.version !== 1)
        throw new Error('Unsupported import version');
    if (!payload.settings || typeof payload.settings !== 'object' ||
        Array.isArray(payload.settings)) {
        throw new Error('Import settings must be an object');
    }

    const known = new Set(settings.list_keys());
    const valid = {};
    const skipped = [];

    for (const [key, value] of Object.entries(payload.settings)) {
        if (INTERNAL_KEYS.has(key) || !known.has(key)) {
            skipped.push(key);
            continue;
        }
        try {
            variantFor(settings, key, value);
            if (!valueAllowed(settings, key, value)) {
                skipped.push(key);
                continue;
            }
            valid[key] = value;
        } catch {
            skipped.push(key);
        }
    }

    let userPresets;
    if ('userPresets' in payload) {
        if (!Array.isArray(payload.userPresets))
            throw new Error('Import userPresets must be an array');
        userPresets = payload.userPresets
            .filter(preset => preset && typeof preset === 'object' &&
                !Array.isArray(preset) &&
                typeof preset.name === 'string' && preset.name.trim() &&
                preset.settings && typeof preset.settings === 'object' &&
                !Array.isArray(preset.settings))
            .map(preset => ({
                name: preset.name.trim().slice(0, 80),
                settings: preset.settings,
            }));
    }

    return {settings: valid, userPresets, skipped};
}

export function applyImport(settings, validated) {
    const result = applySettings(settings, validated.settings);
    if (validated.userPresets)
        writeUserPresets(settings, validated.userPresets);
    bumpReload(settings);
    return {
        ...result,
        importedPresets: validated.userPresets
            ? validated.userPresets.length
            : 0,
    };
}

export function resetModule(settings, moduleId) {
    const keys = MODULE_KEYS[moduleId];
    if (!keys)
        throw new Error(`Unknown module ${moduleId}`);
    for (const key of keys)
        settings.reset(key);
    bumpReload(settings);
}

export function resetAll(settings) {
    for (const key of userFacingKeys(settings))
        settings.reset(key);
    bumpReload(settings);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/presets.test.js
```

Expected: `preset tests passed`.

- [ ] **Step 6: Commit**

```bash
git add extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml \
    extension/src/core/presets.js tests/presets.test.js
git commit -m "feat: add phase 6 preset settings and helpers"
```

---

### Task 2: Reload and Diagnostics Core

**Files:**
- Modify: `extension/src/core/context.js`
- Modify: `extension/src/core/diagnostics.js`
- Modify: `extension/src/core/registry.js`
- Modify: `extension/extension.js`
- Test: `tests/diagnostics.test.js`

**Interfaces:**
- Consumes: `Context`, `Diagnostics`, `ModuleRegistry`, `Gio.Settings`.
- Produces: `Context.resourceCounts()`, `Diagnostics.refresh(resources)`, `ModuleRegistry.reload()`, extension listeners for `reload-request` and `diagnostics-request`.

- [ ] **Step 1: Write the failing diagnostics test**

Create `tests/diagnostics.test.js`:

```javascript
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Context} from '../extension/src/core/context.js';
import {Diagnostics} from '../extension/src/core/diagnostics.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {assertEqual} from './helpers.js';

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
if (!schema)
    throw new Error('schema not compiled; run make schemas first');
const settings = new Gio.Settings({settings_schema: schema});

const context = new Context({uuid: 'test'}, settings);
const scope = context.scope('panel');
scope.signal(settings, 'changed::panel-mode', () => {});
scope.timeout(60000, () => GLib.SOURCE_CONTINUE);

const counts = context.resourceCounts();
assertEqual(counts.panel.signals, 1, 'one panel signal');
assertEqual(counts.panel.sources, 1, 'one panel source');

context.diagnostics.refresh(counts);
const snapshot = JSON.parse(settings.get_string('diagnostics-json'));
assertEqual(snapshot.resources.panel.signals, 1, 'diagnostics writes signals');
assertEqual(snapshot.resources.panel.sources, 1, 'diagnostics writes sources');

context.releaseScope(scope);
assertEqual(Object.keys(context.resourceCounts()).length, 0, 'released scope disappears');

const log = [];
const module = {
    enable() {
        log.push('enable');
    },
    disable() {
        log.push('disable');
    },
};
settings.set_boolean('panel-enabled', true);
const reloadContext = new Context({uuid: 'test'}, settings);
const registry = new ModuleRegistry(reloadContext);
registry.add('panel', module, 'panel-enabled');
registry.enableAll();
registry.reload();
assertEqual(log.join(','), 'enable,disable,enable', 'reload restarts modules');

const direct = new Diagnostics(settings, context.logger);
direct.refresh({panel: {signals: 3, sources: 2}});
const directSnapshot = JSON.parse(settings.get_string('diagnostics-json'));
assertEqual(directSnapshot.resources.panel.signals, 3, 'direct refresh signals');
assertEqual(directSnapshot.resources.panel.sources, 2, 'direct refresh sources');

print('diagnostics tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/diagnostics.test.js
```

Expected: FAIL because `resourceCounts`, `refresh`, and `reload` do not exist.

- [ ] **Step 3: Implement the core changes**

In `extension/src/core/context.js`, add:

```javascript
    resourceCounts() {
        const counts = {};
        for (const scope of this._scopes) {
            counts[scope.name] = {
                signals: scope.signalCount,
                sources: scope.sourceCount,
            };
        }
        return counts;
    }
```

In `extension/src/core/diagnostics.js`, replace the class body with:

```javascript
export class Diagnostics {
    constructor(settings, logger) {
        this._settings = settings;
        this._logger = logger;
        this._modules = new Map();
        this._resources = {};
    }

    setModule(id, status, detail = '') {
        this._modules.set(id, {status, detail});
        this._write();
    }

    refresh(resources) {
        this._resources = resources;
        this._write();
    }

    snapshot() {
        return {
            modules: Object.fromEntries(this._modules),
            resources: this._resources,
            log: this._logger.entries().slice(-20),
        };
    }

    _write() {
        this._settings.set_string('diagnostics-json', JSON.stringify(this.snapshot()));
    }
}
```

In `extension/src/core/registry.js`, add after `enableAll()`:

```javascript
    reload() {
        this.disableAll();
        this.enableAll();
    }
```

In `extension/extension.js`, add after the registry registrations and before `enableAll()`:

```javascript
        this._settingsSignals = [
            this._settings.connect('changed::reload-request',
                () => this._registry.reload()),
            this._settings.connect('changed::diagnostics-request',
                () => this._context.diagnostics.refresh(
                    this._context.resourceCounts())),
        ];
```

In `extension/extension.js` `disable()`, add before `this._registry?.disableAll();`:

```javascript
        for (const id of this._settingsSignals ?? [])
            this._settings.disconnect(id);
        this._settingsSignals = [];
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/diagnostics.test.js
```

Expected: `diagnostics tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/context.js extension/src/core/diagnostics.js \
    extension/src/core/registry.js extension/extension.js \
    tests/diagnostics.test.js
git commit -m "feat: add reload and diagnostics snapshots"
```

---

### Task 3: Panel Workspace Indicator

**Files:**
- Create: `extension/src/modules/panel/workspaceLabel.js`
- Create: `extension/src/modules/panel/workspaceIndicator.js`
- Modify: `extension/src/modules/panel/panelModule.js`
- Test: `tests/workspace-label.test.js`

**Interfaces:**
- Consumes: `ModuleScope`, `PanelMenu.Button`, `St.Label`, `Main.panel`.
- Produces: `workspaceLabel(index)` and `WorkspaceIndicator`.

- [ ] **Step 1: Write the failing workspace label test**

Create `tests/workspace-label.test.js`:

```javascript
import {assertEqual} from './helpers.js';
import {workspaceLabel} from '../extension/src/modules/panel/workspaceLabel.js';

assertEqual(workspaceLabel(0), '1', 'first workspace');
assertEqual(workspaceLabel(3), '4', 'fourth workspace');
print('workspace label tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
gjs -m tests/workspace-label.test.js
```

Expected: FAIL with a missing `workspaceLabel.js` module.

- [ ] **Step 3: Implement the label and indicator**

Create `extension/src/modules/panel/workspaceLabel.js`:

```javascript
export function workspaceLabel(index) {
    return String(index + 1);
}
```

Create `extension/src/modules/panel/workspaceIndicator.js`:

```javascript
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {workspaceLabel} from './workspaceLabel.js';

export class WorkspaceIndicator {
    constructor(scope) {
        this._scope = scope;
        this._button = new PanelMenu.Button(0.0,
            'Homescreen Workspace Indicator', false);
        this._label = new St.Label({
            text: workspaceLabel(0),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'homescreen-workspace-label',
        });
        this._button.add_child(this._label);

        // Verified against GNOME Shell 50.1 panel.js addToStatusArea.
        try {
            Main.panel.addToStatusArea('homescreen-workspace-indicator',
                this._button, 0, 'left');
        } catch (error) {
            this._button.destroy();
            throw error;
        }

        this._signalIds = [
            this._scope.signal(global.workspace_manager,
                'active-workspace-changed', () => this._update()),
            this._scope.signal(global.workspace_manager,
                'workspace-added', () => this._update()),
            this._scope.signal(global.workspace_manager,
                'workspace-removed', () => this._update()),
        ];
        this._update();
    }

    _update() {
        const index = global.workspace_manager.get_active_workspace_index();
        this._label.text = workspaceLabel(index);
    }

    destroy() {
        for (const id of this._signalIds ?? [])
            this._scope.disconnect(id);
        this._signalIds = [];
        this._button?.destroy();
        this._button = null;
        this._label = null;
    }
}
```

In `extension/src/modules/panel/panelModule.js`:

Add the import:

```javascript
import {WorkspaceIndicator} from './workspaceIndicator.js';
```

Add the field in the constructor:

```javascript
        this._workspaceIndicator = null;
```

Add the signal after the `panel-hide-delay` signal:

```javascript
            this._scope.signal(this._settings,
                'changed::panel-show-workspace-indicator',
                () => this._syncWorkspaceIndicator());
```

Call `_syncWorkspaceIndicator()` after `this._bindShortcut();` in `enable()`.

Add the method before `_bindShortcut()`:

```javascript
    _syncWorkspaceIndicator() {
        const enabled = this._settings.get_boolean(
            'panel-show-workspace-indicator');
        if (enabled && !this._workspaceIndicator)
            this._workspaceIndicator = new WorkspaceIndicator(this._scope);
        else if (!enabled && this._workspaceIndicator) {
            this._workspaceIndicator.destroy();
            this._workspaceIndicator = null;
        }
    }
```

In `_rollbackEnable()`, add near the top:

```javascript
        try {
            this._workspaceIndicator?.destroy();
        } catch {
            // Best-effort cleanup.
        }
        this._workspaceIndicator = null;
```

In `disable()`, add before the panel restore:

```javascript
        this._workspaceIndicator?.destroy();
        this._workspaceIndicator = null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
gjs -m tests/workspace-label.test.js
```

Expected: `workspace label tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/panel/workspaceLabel.js \
    extension/src/modules/panel/workspaceIndicator.js \
    extension/src/modules/panel/panelModule.js \
    tests/workspace-label.test.js
git commit -m "feat: add panel workspace indicator"
```

---

### Task 4: Desktop Presentation Settings

**Files:**
- Create: `extension/src/modules/desktop/externalState.js`
- Create: `extension/src/modules/desktop/caffeine.js`
- Modify: `extension/src/modules/desktop/desktopModule.js`
- Test: `tests/external-state.test.js`

**Interfaces:**
- Consumes: `Gio.Settings`, `Gio.DBus.session`, `ModuleScope`.
- Produces: `snapshotBoolean`, `snapshotString`, `restoreBooleanIfUnchanged`, `restoreStringIfUnchanged`, `CAFFEINE_FLAGS`, `CaffeineInhibitor`.

- [ ] **Step 1: Write the failing external-state test**

Create `tests/external-state.test.js`:

```javascript
import {assertEqual, waitFor} from './helpers.js';
import {
    restoreBooleanIfUnchanged,
    restoreStringIfUnchanged,
    snapshotBoolean,
    snapshotString,
} from '../extension/src/modules/desktop/externalState.js';
import {CAFFEINE_FLAGS, CaffeineInhibitor} from '../extension/src/modules/desktop/caffeine.js';

class FakeSettings {
    constructor(values) {
        this.values = {...values};
    }

    get_boolean(key) {
        return this.values[key];
    }

    set_boolean(key, value) {
        this.values[key] = value;
    }

    get_string(key) {
        return this.values[key];
    }

    set_string(key, value) {
        this.values[key] = value;
    }
}

const notifications = new FakeSettings({'show-banners': true});
const bannerSnapshot = snapshotBoolean(notifications, 'show-banners');
notifications.set_boolean('show-banners', false);
restoreBooleanIfUnchanged(notifications, 'show-banners', false, bannerSnapshot);
assertEqual(notifications.get_boolean('show-banners'), true, 'banner restored');

const changed = new FakeSettings({'show-banners': true});
const changedSnapshot = snapshotBoolean(changed, 'show-banners');
changed.set_boolean('show-banners', false);
changed.set_boolean('show-banners', true);
restoreBooleanIfUnchanged(changed, 'show-banners', false, changedSnapshot);
assertEqual(changed.get_boolean('show-banners'), true, 'changed banner kept');

const wm = new FakeSettings({'button-layout': 'appmenu:minimize,maximize,close'});
const layoutSnapshot = snapshotString(wm, 'button-layout');
wm.set_string('button-layout', 'appmenu:close,minimize,maximize');
restoreStringIfUnchanged(wm, 'button-layout',
    'appmenu:close,minimize,maximize', layoutSnapshot);
assertEqual(wm.get_string('button-layout'),
    'appmenu:minimize,maximize,close', 'layout restored');

assertEqual(CAFFEINE_FLAGS, 12, 'caffeine flags');

const calls = [];
const inhibitor = new CaffeineInhibitor(async (method, params) => {
    calls.push([method, params.deepUnpack()]);
    return method === 'Inhibit' ? 42 : 0;
}, {appId: 'test', reason: 'testing'});
const cookie = waitFor(inhibitor.inhibit());
assertEqual(cookie, 42, 'inhibit cookie');
assertEqual(calls[0][0], 'Inhibit', 'inhibit called');
assertEqual(calls[0][1][3], 12, 'inhibit flags');
waitFor(inhibitor.release());
assertEqual(calls[1][0], 'Uninhibit', 'uninhibit called');
assertEqual(calls[1][1][0], 42, 'uninhibit cookie');

const lateCalls = [];
let resolveInhibit;
const late = new CaffeineInhibitor((method, params) => {
    lateCalls.push(method);
    if (method === 'Inhibit') {
        return new Promise(resolve => {
            resolveInhibit = resolve;
        });
    }
    return Promise.resolve(0);
}, {appId: 'test', reason: 'late'});
const pending = late.inhibit();
waitFor(late.release());
resolveInhibit(7);
assertEqual(waitFor(pending), 0, 'late inhibit discarded');
assertEqual(lateCalls.includes('Uninhibit'), true, 'late inhibit released');

print('external state tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
gjs -m tests/external-state.test.js
```

Expected: FAIL with missing `externalState.js` or `caffeine.js`.

- [ ] **Step 3: Implement the helpers**

Create `extension/src/modules/desktop/externalState.js`:

```javascript
export function snapshotBoolean(settings, key) {
    return settings.get_boolean(key);
}

export function snapshotString(settings, key) {
    return settings.get_string(key);
}

export function restoreBooleanIfUnchanged(settings, key, expected, value) {
    if (settings.get_boolean(key) === expected)
        settings.set_boolean(key, value);
}

export function restoreStringIfUnchanged(settings, key, expected, value) {
    if (settings.get_string(key) === expected)
        settings.set_string(key, value);
}
```

Create `extension/src/modules/desktop/caffeine.js`:

```javascript
import GLib from 'gi://GLib';

export const CAFFEINE_FLAGS = 12;

export class CaffeineInhibitor {
    constructor(call, {appId, reason}) {
        this._call = call;
        this._appId = appId;
        this._reason = reason;
        this._cookie = 0;
        this._generation = 0;
    }

    get cookie() {
        return this._cookie;
    }

    async inhibit() {
        if (this._cookie)
            return this._cookie;

        const generation = ++this._generation;
        const cookie = await this._call('Inhibit',
            new GLib.Variant('(susu)', [
                this._appId, 0, this._reason, CAFFEINE_FLAGS,
            ]));

        if (generation !== this._generation) {
            await this._call('Uninhibit', new GLib.Variant('(u)', [cookie]));
            return 0;
        }

        this._cookie = cookie;
        return cookie;
    }

    async release() {
        this._generation++;
        if (!this._cookie)
            return;
        const cookie = this._cookie;
        this._cookie = 0;
        await this._call('Uninhibit', new GLib.Variant('(u)', [cookie]));
    }
}
```

In `extension/src/modules/desktop/desktopModule.js`:

Add imports:

```javascript
import {CaffeineInhibitor} from './caffeine.js';
import {
    restoreBooleanIfUnchanged,
    restoreStringIfUnchanged,
    snapshotBoolean,
    snapshotString,
} from './externalState.js';
```

Add constants:

```javascript
const NOTIFICATIONS_SCHEMA = 'org.gnome.desktop.notifications';
const NOTIFICATIONS_KEY = 'show-banners';
const WM_PREFERENCES_SCHEMA = 'org.gnome.desktop.wm.preferences';
const BUTTON_LAYOUT_KEY = 'button-layout';
const MACOS_BUTTON_LAYOUT = 'appmenu:close,minimize,maximize';
```

Add fields in the constructor:

```javascript
        this._notifications = null;
        this._notificationsSnapshot = null;
        this._wmPreferences = null;
        this._buttonLayoutSnapshot = null;
        this._caffeine = null;
```

Add this helper before `_findDingSettings()`:

```javascript
    _findSettings(schemaId) {
        try {
            const source = Gio.SettingsSchemaSource.get_default();
            const schema = source.lookup(schemaId, true);
            return schema ? new Gio.Settings({settings_schema: schema}) : null;
        } catch {
            return null;
        }
    }
```

In `enable()`, after the DING block and before the settings signals, add:

```javascript
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
```

Add these signals after the `desktop-show-desktop-shortcut` signal:

```javascript
            this._scope.signal(this._settings,
                'changed::desktop-mute-notifications',
                () => this._applyNotifications());
            this._scope.signal(this._settings,
                'changed::desktop-caffeine',
                () => this._applyCaffeine());
            this._scope.signal(this._settings,
                'changed::desktop-macos-controls',
                () => this._applyWindowControls());
```

Add these calls after `this._applyFocusMode();` in `enable()`:

```javascript
            this._applyNotifications();
            this._applyCaffeine();
            this._applyWindowControls();
```

Add these methods before `_applyIcons()`:

```javascript
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
```

In `_teardown()`, add before the DING restore:

```javascript
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
```

At the end of `_teardown()`, before `this._context = null;`, add:

```javascript
        this._notifications = null;
        this._notificationsSnapshot = null;
        this._wmPreferences = null;
        this._buttonLayoutSnapshot = null;
        this._caffeine = null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
gjs -m tests/external-state.test.js
```

Expected: `external state tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/desktop/externalState.js \
    extension/src/modules/desktop/caffeine.js \
    extension/src/modules/desktop/desktopModule.js \
    tests/external-state.test.js
git commit -m "feat: add desktop presentation settings"
```

---

### Task 5: Preference Rows and Reset Helper

**Files:**
- Modify: `extension/src/prefs/helpers.js`
- Modify: `extension/src/prefs/panelPage.js`
- Modify: `extension/src/prefs/desktopPage.js`
- Modify: `extension/src/prefs/dockPage.js`
- Modify: `extension/src/prefs/visualPage.js`
- Modify: `extension/src/prefs/tilingPage.js`
- Modify: `extension/src/prefs/monitorPage.js`
- Modify: `extension/src/prefs/appGridPage.js`
- Modify: `extension/src/prefs/lockscreenPage.js`

**Interfaces:**
- Consumes: `resetModule(settings, moduleId)`.
- Produces: `resetRow(settings, moduleId)`.

- [ ] **Step 1: Add the reset row helper**

In `extension/src/prefs/helpers.js`, add the import:

```javascript
import {resetModule} from '../core/presets.js';
```

Add at the end:

```javascript
export function resetRow(settings, moduleId) {
    const row = new Adw.ActionRow({
        title: 'Reset this page',
        subtitle: 'Restore this page to its defaults.',
    });
    const button = new Gtk.Button({
        label: 'Reset',
        valign: Gtk.Align.CENTER,
    });
    button.add_css_class('destructive-action');
    button.connect('clicked', () => resetModule(settings, moduleId));
    row.add_suffix(button);
    return row;
}
```

- [ ] **Step 2: Add the panel and desktop controls**

In `panelPage.js`, import `resetRow`:

```javascript
import {comboRow, resetRow, shortcutRow, spinRow, spinRowDouble, switchRow} from './helpers.js';
```

Add the workspace row to the `overview` group:

```javascript
    overview.add(switchRow(settings, 'panel-show-workspace-indicator',
        'Workspace indicator', 'Show the current workspace number in the panel.'));
```

Add a reset group before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'panel'));
```

In `desktopPage.js`, import `resetRow`:

```javascript
import {resetRow, shortcutRow, switchRow} from './helpers.js';
```

Add a system group before the reset group:

```javascript
    const system = new Adw.PreferencesGroup({title: 'System'});
    page.add(system);
    system.add(switchRow(settings, 'desktop-mute-notifications',
        'Mute notifications', 'Hide notification banners while enabled.'));
    system.add(switchRow(settings, 'desktop-caffeine',
        'Caffeine', 'Inhibit idle and suspend while enabled.'));
    system.add(switchRow(settings, 'desktop-macos-controls',
        'macOS window controls', 'Use close, minimize, maximize order.'));
```

Add a reset group before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'desktop'));
```

- [ ] **Step 3: Add reset rows to the remaining pages**

In `dockPage.js`, change the helpers import to:

```javascript
import {comboRow, resetRow, spinRow, spinRowDouble, switchRow} from './helpers.js';
```

Add before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'dock'));
```

In `visualPage.js`, change the helpers import to:

```javascript
import {resetRow, spinRow, spinRowDouble, switchRow} from './helpers.js';
```

Add before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'visual'));
```

In `tilingPage.js`, change the helpers import to:

```javascript
import {resetRow, shortcutRow, spinRow, switchRow} from './helpers.js';
```

Add before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'tiling'));
```

In `monitorPage.js`, change the helpers import to:

```javascript
import {resetRow, spinRow, switchRow} from './helpers.js';
```

Add before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'monitor'));
```

In `appGridPage.js`, change the helpers import to:

```javascript
import {resetRow, spinRow, switchRow} from './helpers.js';
```

Add before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'app-grid'));
```

In `lockscreenPage.js`, change the helpers import to:

```javascript
import {resetRow, switchRow, textRow} from './helpers.js';
```

Add before `return page;`:

```javascript
    const reset = new Adw.PreferencesGroup({title: 'Reset'});
    page.add(reset);
    reset.add(resetRow(settings, 'lockscreen'));
```

- [ ] **Step 4: Run the syntax and unit gate**

Run:

```bash
make test
```

Expected: all suites pass. If an import name is missing, the syntax check fails and names the file.

- [ ] **Step 5: Commit**

```bash
git add extension/src/prefs/helpers.js extension/src/prefs/panelPage.js \
    extension/src/prefs/desktopPage.js extension/src/prefs/dockPage.js \
    extension/src/prefs/visualPage.js extension/src/prefs/tilingPage.js \
    extension/src/prefs/monitorPage.js extension/src/prefs/appGridPage.js \
    extension/src/prefs/lockscreenPage.js
git commit -m "feat: add preferences reset rows"
```

---

### Task 6: Presets Preferences Page

**Files:**
- Create: `extension/src/prefs/presetsPage.js`
- Modify: `extension/prefs.js`

**Interfaces:**
- Consumes: all preset exports, `Gtk.FileChooserNative`, `Adw.MessageDialog`.
- Produces: `buildPresetsPage(window, settings)`.

- [ ] **Step 1: Implement the presets page**

Create `extension/src/prefs/presetsPage.js`:

```javascript
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
```

- [ ] **Step 2: Wire the page into `prefs.js`**

Add the import:

```javascript
import {buildPresetsPage} from './src/prefs/presetsPage.js';
```

Add after `buildLockscreenPage(window, settings);`:

```javascript
        buildPresetsPage(window, settings);
```

- [ ] **Step 3: Run the gate**

Run:

```bash
make test
```

Expected: all suites pass, including the JavaScript syntax check for `presetsPage.js`.

- [ ] **Step 4: Commit**

```bash
git add extension/src/prefs/presetsPage.js extension/prefs.js
git commit -m "feat: add presets preferences page"
```

---

### Task 7: Diagnostics Preferences Page

**Files:**
- Create: `extension/src/prefs/diagnosticsFormat.js`
- Create: `extension/src/prefs/diagnosticsPage.js`
- Modify: `extension/prefs.js`
- Test: `tests/diagnostics-format.test.js`

**Interfaces:**
- Consumes: `diagnostics-json`, `diagnostics-request`.
- Produces: `parseDiagnostics(text)` and `buildDiagnosticsPage(window, settings)`.

- [ ] **Step 1: Write the failing format test**

Create `tests/diagnostics-format.test.js`:

```javascript
import {assertEqual} from './helpers.js';
import {parseDiagnostics} from '../extension/src/prefs/diagnosticsFormat.js';

const parsed = parseDiagnostics(JSON.stringify({
    modules: {panel: {status: 'enabled', detail: ''}},
    resources: {panel: {signals: 2, sources: 1}},
    log: [{level: 'info', message: 'panel enabled', time: 1}],
}));
assertEqual(parsed.modules.panel.status, 'enabled', 'module parsed');
assertEqual(parsed.resources.panel.signals, 2, 'resource parsed');
assertEqual(parsed.log.length, 1, 'log parsed');

const empty = parseDiagnostics('not json');
assertEqual(Object.keys(empty.modules).length, 0, 'invalid modules empty');
assertEqual(Object.keys(empty.resources).length, 0, 'invalid resources empty');
assertEqual(empty.log.length, 0, 'invalid log empty');

print('diagnostics format tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
gjs -m tests/diagnostics-format.test.js
```

Expected: FAIL with a missing `diagnosticsFormat.js` module.

- [ ] **Step 3: Implement the format helper and page**

Create `extension/src/prefs/diagnosticsFormat.js`:

```javascript
export function parseDiagnostics(text) {
    try {
        const value = JSON.parse(text);
        return {
            modules: value?.modules && typeof value.modules === 'object'
                ? value.modules
                : {},
            resources: value?.resources && typeof value.resources === 'object'
                ? value.resources
                : {},
            log: Array.isArray(value?.log) ? value.log : [],
        };
    } catch {
        return {modules: {}, resources: {}, log: []};
    }
}
```

Create `extension/src/prefs/diagnosticsPage.js`:

```javascript
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
                const time = GLib.DateTime.new_from_unix_local(
                    Math.floor((entry.time ?? 0) / 1000)).format('%H:%M:%S');
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
```

- [ ] **Step 4: Wire the page into `prefs.js`**

Add the import:

```javascript
import {buildDiagnosticsPage} from './src/prefs/diagnosticsPage.js';
```

Add after `buildPresetsPage(window, settings);`:

```javascript
        buildDiagnosticsPage(window, settings);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
gjs -m tests/diagnostics-format.test.js
make test
```

Expected: `diagnostics format tests passed` and the full unit gate passes.

- [ ] **Step 6: Commit**

```bash
git add extension/src/prefs/diagnosticsFormat.js \
    extension/src/prefs/diagnosticsPage.js extension/prefs.js \
    tests/diagnostics-format.test.js
git commit -m "feat: add diagnostics preferences page"
```

---

### Task 8: About Page and Page Order

**Files:**
- Create: `extension/src/prefs/aboutPage.js`
- Modify: `extension/prefs.js`

**Interfaces:**
- Consumes: `ExtensionPreferences.metadata`.
- Produces: `buildAboutPage(window, metadata)`.

- [ ] **Step 1: Implement the About page**

Create `extension/src/prefs/aboutPage.js`:

```javascript
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

function linkRow(title, uri) {
    const row = new Adw.ActionRow({
        title,
        subtitle: uri,
        activatable: true,
    });
    row.connect('activated', () => {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch {
            // Best-effort link opening.
        }
    });
    return row;
}

export function buildAboutPage(window, metadata) {
    const page = new Adw.PreferencesPage({
        title: 'About',
        icon_name: 'help-about-symbolic',
    });
    window.add(page);

    const about = new Adw.PreferencesGroup({title: 'Homescreen'});
    page.add(about);
    about.add(new Adw.ActionRow({
        title: 'Version',
        subtitle: metadata.version ?? 'Unknown',
    }));
    about.add(new Adw.ActionRow({
        title: 'UUID',
        subtitle: metadata.uuid ?? '',
    }));
    about.add(new Adw.ActionRow({
        title: 'Shell versions',
        subtitle: (metadata['shell-version'] ?? []).join(', '),
    }));
    about.add(new Adw.ActionRow({
        title: 'License',
        subtitle: 'GPL-3.0-or-later',
    }));

    const links = new Adw.PreferencesGroup({title: 'Links'});
    page.add(links);
    links.add(linkRow('Repository',
        'https://github.com/engida32/homescreen'));
    links.add(linkRow('Issues',
        'https://github.com/engida32/homescreen/issues'));

    return page;
}
```

- [ ] **Step 2: Wire the About page**

In `prefs.js`, add the import:

```javascript
import {buildAboutPage} from './src/prefs/aboutPage.js';
```

Add after `buildDiagnosticsPage(window, settings);`:

```javascript
        buildAboutPage(window, this.metadata);
```

The final order must be Panel, Dock, Visual, Tiling, Monitor, App Grid, Desktop, Lockscreen, Presets, Diagnostics, About.

- [ ] **Step 3: Run the gate**

Run:

```bash
make test
```

Expected: all suites pass and `aboutPage.js` passes the syntax check.

- [ ] **Step 4: Commit**

```bash
git add extension/src/prefs/aboutPage.js extension/prefs.js
git commit -m "feat: add about page"
```

---

### Task 9: Documentation and Packaging Probe

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `tests/headless-install-probe.sh`

**Interfaces:**
- Consumes: the new schema keys and packaged files.
- Produces: documentation and probe coverage.

- [ ] **Step 1: Update the README**

Change the status line to:

```markdown
Status: Phase 6 is implemented and tested headlessly. It is not published on extensions.gnome.org yet, and the live Wayland matrix is still pending.
```

Add these feature bullets after the app-grid bullet:

```markdown
- Five built-in presets and user presets, with readable JSON export and import.
- Per-module and full reset, with the running extension reloading modules immediately.
- A diagnostics page with module status, per-module signal and source counts, and recent log entries.
- An optional panel workspace indicator.
- Optional notification mute, Caffeine idle/suspend inhibition, and macOS window button order.
```

Change the preferences paragraph to:

```markdown
Open the extension preferences from GNOME Extensions or Extension Manager. The window has eleven pages:
```

Add these preference bullets after Lockscreen:

```markdown
- Presets: built-in presets, user presets, export, import, and full reset.
- Diagnostics: module status, resource counts, recent log entries, and refresh.
- About: version, UUID, supported Shell versions, license, and links.
```

Add this to the project layout after `src/core/`:

```text
  src/core/presets.js   preset data, export/import, reset, reload request
```

Replace the existing desktop layout line with:

```text
  src/modules/desktop/  DING, focus mode, Show Desktop, notification mute, Caffeine, window controls
```

Add this Phase 6 limits section before `## License`:

```markdown
## Phase 6 limits

- Presets apply a complete settings snapshot. Applying a preset restarts enabled modules, so the panel and dock may briefly flicker.
- Export excludes diagnostics history and internal request counters.
- Import skips unknown or wrong-typed keys and reports the count.
- Full reset keeps user presets.
- The workspace indicator is a label only. Workspace thumbnails and preview popups are not implemented.
- Caffeine inhibits idle and suspend. It does not inhibit logout, user switching, or automount.
- macOS window controls only reorder the standard window buttons. They do not restyle window decorations.
- Live Wayland verification remains manual.
```

- [ ] **Step 2: Update `DESIGN.md`**

Change the status line at the top of `DESIGN.md` to:

```markdown
Status: Phase 6 implemented, live verification pending
```

After the Phase 5 paragraph, add:

```markdown
Phase 6 implements presets, readable settings export and import, per-module and full reset, live diagnostics, the panel workspace indicator, notification mute, Caffeine idle/suspend inhibition, macOS window button order, and the About page. Applying a preset, import, or reset restarts modules through a reload request. Full reset preserves user presets. Window corner rounding remains deferred.
```

- [ ] **Step 3: Extend the install probe**

In `tests/headless-install-probe.sh`, after the schema XML check, add:

```bash
SCHEMA="$EXT_DIR/schemas/org.gnome.shell.extensions.homescreen.gschema.xml"
for key in \
    panel-show-workspace-indicator \
    desktop-mute-notifications \
    desktop-caffeine \
    desktop-macos-controls \
    user-presets-json \
    reload-request \
    diagnostics-request; do
    grep -Fq "name=\"$key\"" "$SCHEMA"
done

for file in \
    src/core/presets.js \
    src/prefs/presetsPage.js \
    src/prefs/diagnosticsPage.js \
    src/prefs/aboutPage.js; do
    test -f "$EXT_DIR/$file"
done
```

- [ ] **Step 4: Run the full gate**

Run:

```bash
make check
```

Expected: all tests pass and the final line is `PROBE_OK`.

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md tests/headless-install-probe.sh
git commit -m "docs: document phase 6 and extend install probe"
```

---

### Task 10: Final Verification

**Files:**
- No new files. Fix any failure in the owning task.

**Interfaces:**
- Consumes: the complete Phase 6 implementation.
- Produces: a verified branch and a manual verification checklist.

- [ ] **Step 1: Run the full headless gate**

Run:

```bash
make check
```

Expected: all suites pass and the final line is `PROBE_OK`.

- [ ] **Step 2: Review the changed surface**

Run:

```bash
git status --short
git diff --stat 4c43566..HEAD
```

Expected: only Phase 6 schema, core, module, preferences, tests, and documentation files are changed. No generated schema, zip, or local-only files are staged.

- [ ] **Step 3: Manual Wayland checklist**

On a logged-in GNOME 50.1 Wayland session, run:

```bash
make install
```

Log out and back in, then verify:

- Clean, Sonoma, Power, Presentation, and Minimal apply and reload modules.
- Save a user preset, apply it, export it, delete it, and import it back.
- Import a file with one unknown key and confirm the banner reports the skip.
- Per-module reset changes only that page.
- Full reset restores defaults and keeps user presets.
- Diagnostics shows module status, resource counts, and log entries.
- The workspace indicator appears and disappears with its switch.
- Notification mute and macOS window controls restore the prior values on disable.
- Caffeine appears in `org.gnome.SessionManager.GetInhibitors` while enabled and disappears on disable.

- [ ] **Step 4: Commit any final fixes**

If Step 1 or Step 3 required code changes, commit them with a Conventional Commit message that names the fixed behavior. Do not amend an earlier commit.
