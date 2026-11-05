# Phase 6: Presets, Diagnostics, and Packaging Design

Date: 2026-11-05
Status: Approved design and written spec
Target: Ubuntu 26.04, GNOME Shell 50.1, Wayland

## Goal

Finish Homescreen Phase 6 by adding deterministic presets, readable
settings export/import, per-module and full reset, live diagnostics, the
remaining desktop and panel settings named in `DESIGN.md`, and a
packaging check that covers the new surface.

The result must leave the extension usable after a preset, import, or
reset without requiring the user to manually disable and re-enable it.

## Scope

In scope:

- Five built-in presets: Clean, Sonoma, Power, Presentation, Minimal.
- User-created presets captured from the current settings.
- JSON export and import.
- Per-module reset and full reset.
- Diagnostics page with module status, per-module resource counts, and
  recent log entries.
- Workspace indicator in the panel.
- Notification mute.
- Caffeine session inhibition.
- macOS-style window button order.
- About page.
- Headless packaging coverage for the new schema keys and files.

Out of scope:

- Window corner rounding. There is no existing corner-radius setting,
  and adding it would require a separate window-decoration feature.
- Preset editing beyond apply, save current settings, and delete.
- Automatic re-application of presets when settings change elsewhere.
- Live Wayland interaction verification. That remains a manual matrix
  after installation.

## Architecture

### New preset module

Add `extension/src/core/presets.js`. It owns preset data, settings
serialization, import validation, reset key maps, and the reload
request. It must stay free of Shell imports so it can be tested under
plain GJS.

Public API:

- `INTERNAL_KEYS`: keys excluded from export and user preset snapshots.
- `BUILTIN_PRESETS`: ordered definitions of `{id, name, description, overrides}`.
- `builtinPresets(settings)`: resolved presets with full `settings` maps.
- `MODULE_KEYS`: module id to user-facing setting keys.
- `snapshotSettings(settings)`: object of every non-internal key and its
  unpacked value.
- `applySettings(settings, values)`: applies known, correctly typed
  values and returns `{applied, skipped}`.
- `applyPreset(settings, preset)`: applies a preset and bumps the reload
  request.
- `loadUserPresets(settings)`: parsed array, or `[]` on invalid JSON.
- `writeUserPresets(settings, presets)`: stores the array as JSON.
- `saveUserPreset(settings, name)`: appends a snapshot and returns the
  updated array.
- `exportPayload(settings)`: `{version, settings, userPresets}`.
- `validateImportPayload(payload, settings)`: returns
  `{settings, userPresets, skipped}` without writing.
- `applyImport(settings, validated)`: writes settings and user presets,
  then bumps the reload request.
- `resetModule(settings, moduleId)`: resets that module's keys to schema
  defaults and bumps the reload request.
- `resetAll(settings)`: resets every non-internal key to schema defaults,
  preserves user presets, and bumps the reload request.
- `bumpReload(settings)`: increments `reload-request`.

Value conversion uses `settings.get_value(key).deepUnpack()` for export.
Import checks each value against the schema key's type, enum, and range
before constructing a `GLib.Variant` and writing it. The variant
constructor alone is not sufficient because it coerces some values, such
as truncating a fractional integer and accepting an out-of-range number
with only a warning. No value is written until every import value has
passed validation.

### Reload path

Add a `reload-request` integer key, default `0`.

`extension.js` connects to `changed::reload-request` and calls
`registry.reload()`. `ModuleRegistry.reload()` runs `disableAll()` then
`enableAll()`. This restarts every module against the new settings, so
module enable switches and external state are applied immediately.

The connection is stored and disconnected in `disable()`.

### Diagnostics path

Add `Context.resourceCounts()` returning an object keyed by scope name:

```js
{
  panel: {signals: 12, sources: 1},
  dock: {signals: 9, sources: 0}
}
```

`ModuleScope.name` is already the module id, so no extra registry state
is needed.

Extend `Diagnostics` with:

- `refresh(resources)`: stores the resource snapshot and writes JSON.
- `snapshot()`: includes `modules`, `resources`, and `log`.

Add a `diagnostics-request` integer key, default `0`. `extension.js`
connects to `changed::diagnostics-request` and calls
`context.diagnostics.refresh(context.resourceCounts())`.

The preferences process never reaches into the Shell process. It writes
the request counter and reads `diagnostics-json`.

## Schema Additions

Add to `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `panel-show-workspace-indicator` | `b` | `false` | Show the workspace label in the panel |
| `desktop-mute-notifications` | `b` | `false` | Mute notification banners while enabled |
| `desktop-caffeine` | `b` | `false` | Inhibit idle and suspend while enabled |
| `desktop-macos-controls` | `b` | `false` | Put close/minimize/maximize in macOS order |
| `user-presets-json` | `s` | `'[]'` | User preset storage |
| `reload-request` | `i` | `0` | Internal module reload counter |
| `diagnostics-request` | `i` | `0` | Internal diagnostics refresh counter |

`diagnostics-json` remains the diagnostics response key.

`INTERNAL_KEYS` contains `diagnostics-json`, `diagnostics-request`,
`reload-request`, and `user-presets-json`.

## Presets

Built-in presets are generated from schema defaults plus explicit
overrides. Unspecified keys therefore follow the current schema default,
and new keys are covered automatically when the schema changes.

### Clean

No overrides. Uses schema defaults: autohide panel and dock, hidden
desktop icons, no blur, no monitor, no tiling, no lockscreen, no app-grid
customization.

### Sonoma

| Key | Value |
|---|---|
| `visual-enabled` | `true` |
| `visual-blur-panel` | `true` |
| `visual-blur-dock` | `true` |
| `visual-blur-overview` | `true` |
| `dock-radius` | `28` |
| `lockscreen-enabled` | `true` |
| `app-grid-enabled` | `true` |
| `app-grid-launchpad` | `true` |
| `desktop-macos-controls` | `true` |

Dock magnification, bottom position, autohide, intellihide, and the
default opacity already match Sonoma intent.

### Power

| Key | Value |
|---|---|
| `panel-mode` | `always` |
| `panel-show-workspace-indicator` | `true` |
| `dock-autohide` | `false` |
| `dock-intellihide` | `false` |
| `monitor-enabled` | `true` |
| `tiling-enabled` | `true` |

### Presentation

| Key | Value |
|---|---|
| `panel-mode` | `hidden` |
| `dock-enabled` | `false` |
| `desktop-mute-notifications` | `true` |
| `desktop-caffeine` | `true` |
| `visual-enabled` | `false` |
| `monitor-enabled` | `false` |
| `tiling-enabled` | `false` |
| `app-grid-enabled` | `false` |
| `lockscreen-enabled` | `false` |

### Minimal

| Key | Value |
|---|---|
| `panel-mode` | `always` |
| `dock-enabled` | `false` |
| `desktop-hide-icons` | `true` |
| `visual-enabled` | `false` |
| `monitor-enabled` | `false` |
| `tiling-enabled` | `false` |
| `app-grid-enabled` | `false` |
| `lockscreen-enabled` | `false` |

### User presets

A user preset is `{name, settings}` where `settings` is a full snapshot
of every non-internal key at save time. Names are trimmed, must be
non-empty, and are limited to 80 characters. Duplicate names are allowed;
rows are identified by index. There is no rename action in this phase.

## Export and Import

Export payload:

```json
{
  "version": 1,
  "settings": {
    "panel-mode": "autohide",
    "dock-enabled": true
  },
  "userPresets": [
    {
      "name": "My setup",
      "settings": {
        "panel-mode": "always"
      }
    }
  ]
}
```

Rules:

- Export includes every non-internal setting and all user presets.
- Import requires a JSON object with `version: 1`.
- `settings` must be an object. Each key must exist in the schema and
  must not be internal.
- A value that fails the explicit type, enum, or range check is
  skipped.
- Unknown keys are skipped.
- If `userPresets` is absent, existing user presets are preserved.
- If `userPresets` is present, it must be an array. A non-array value
  rejects the import. Entries without a non-empty `name` or with a
  non-object `settings` are skipped.
- If `userPresets` is present, the validated array replaces the stored
  user presets.
- No setting is written until validation completes. Invalid or unknown
  setting entries are skipped, not partially applied.
- After writing, the reload request is bumped.
- The UI reports the number of applied settings, skipped keys, and
  imported presets.

File handling uses `Gtk.FileChooserNative` with a JSON filter. The
preferences process reads and writes the selected file asynchronously
through `Gio.File`. Imports larger than 1 MiB are rejected.

## Reset

`MODULE_KEYS` maps each module to its user-facing keys:

- `panel`: `panel-*`
- `dock`: `dock-*`
- `desktop`: `desktop-*`
- `lockscreen`: `lockscreen-*`
- `visual`: `visual-*`
- `tiling`: `tiling-*`
- `monitor`: `monitor-*`
- `app-grid`: `app-grid-*`

Each existing preferences page gets a reset row at the bottom. The row
resets only that module's keys to schema defaults and bumps the reload
request.

The Presets page gets a full-reset row. Full reset resets every
non-internal key to its schema default, preserves user presets, and
bumps the reload request. The user is asked to confirm full reset.

Reset does not delete exported files, user presets, or diagnostics
history.

## Diagnostics UI

Add `extension/src/prefs/diagnosticsPage.js`.

The page contains:

- Status group: one row per module with status and detail.
- Resources group: one row per module with signal and source counts, plus
  a total row.
- Log group: the last 20 log entries, newest first, with level, local
  time, and message.
- Refresh button that increments `diagnostics-request`.

On page build, render the current `diagnostics-json`, then request a
fresh snapshot. The page listens to `changed::diagnostics-json` and
rerenders. Empty or invalid JSON renders an empty state rather than
throwing.

## Missing Settings

### Workspace indicator

Add the indicator inside `PanelModule` so it shares the panel lifecycle.

- A `PanelMenu.Button` with a text label showing the active workspace
  number.
- Added to the left panel box through
  `Main.panel.addToStatusArea('homescreen-workspace-indicator', button, 0, 'left')`.
- Updates on `active-workspace-changed`, `workspace-added`, and
  `workspace-removed`.
- Listens to `changed::panel-show-workspace-indicator` and creates or
  destroys the button without restarting the panel module.
- The button is destroyed on module disable.
- The setting is `panel-show-workspace-indicator`.

The indicator is a label only. Workspace thumbnails and a full preview
popup remain out of scope.

### Notification mute

Add to `DesktopModule`.

- On module enable, snapshot
  `org.gnome.desktop.notifications show-banners` once.
- If `desktop-mute-notifications` is true, set the value to `false`.
- Listen to `changed::desktop-mute-notifications` and apply or restore
  immediately.
- On disable, restore the snapshot only if the current value is still
  `false`.
- A user who changes the value while Homescreen is enabled is not
  overridden.
- The external settings object is created with
  `new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'})`.

### Caffeine

Add to `DesktopModule`.

- On module enable, if `desktop-caffeine` is true, call
  `org.gnome.SessionManager.Inhibit` with:
  - app id: `homescreen@engida32.github.io`
  - toplevel xid: `0`
  - reason: `Homescreen presentation mode`
  - flags: `12` (`suspend = 4`, `idle = 8`)
- Store the returned cookie.
- Listen to `changed::desktop-caffeine`. Turning it on requests an
  inhibitor; turning it off releases the stored cookie.
- On disable, call `Uninhibit` with the cookie.
- The call is asynchronous. A generation counter prevents a late
  Inhibit reply from storing a cookie after disable.
- Live probe on the running session manager returned flags `4` for
  `suspend` and `8` for `idle`.

### macOS window controls

Add to `DesktopModule`.

- On module enable, snapshot
  `org.gnome.desktop.wm.preferences button-layout` once.
- If `desktop-macos-controls` is true, write
  `appmenu:close,minimize,maximize`.
- Listen to `changed::desktop-macos-controls` and apply or restore
  immediately.
- On disable, restore the snapshot only if the current value is still
  the value written by Homescreen.
- The external settings object is created with
  `new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'})`.

## Preferences UI

Add three pages:

- `extension/src/prefs/presetsPage.js`
- `extension/src/prefs/diagnosticsPage.js`
- `extension/src/prefs/aboutPage.js`

`prefs.js` adds them after the existing module pages in this order:
Panel, Dock, Visual, Tiling, Monitor, App Grid, Desktop, Lockscreen,
Presets, Diagnostics, About.

Presets page groups:

- Built-in presets: one row per preset with Apply.
- User presets: one row per preset with Apply and Delete, plus a Save
  current settings row.
- Transfer: Export and Import rows.
- Reset: full-reset row with confirmation.

A shared `addResetRow(page, settings, moduleId)` helper lives in
`extension/src/prefs/helpers.js` or a new `resetRow.js`. It adds an
`Adw.ActionRow` with a Reset button and calls `resetModule`.

The About page shows the extension name, version from
`this.metadata.version`, UUID, supported Shell versions, GPLv3, and
links to the repository and issue tracker. Links open with
`Gio.AppInfo.launch_default_for_uri`.

The Desktop page gains rows for notification mute, Caffeine, and macOS
window controls. The Panel page gains the workspace indicator row.

## Error Handling

- Invalid user-preset JSON loads as an empty list. The Presets page
  shows a banner explaining that stored presets could not be read.
- Invalid diagnostics JSON renders an empty state.
- Import validation errors show a banner with the reason. No settings
  are written.
- File read/write errors show a banner with the error message.
- A failed module reload is already isolated by `ModuleRegistry`; one
  module failure does not stop the others.
- External settings restore is best-effort and guarded by the
  value-unchanged check.
- Caffeine D-Bus failure logs through the module logger and does not
  throw out of `enable()`.

## Testing

Add `tests/presets.test.js`:

- Built-in presets are complete against the schema's non-internal keys.
- Applying a preset writes expected values and bumps `reload-request`.
- `snapshotSettings` excludes internal keys.
- Export payload round-trips through validation.
- Unknown keys are skipped.
- Wrong-typed values are skipped.
- Invalid version is rejected.
- User presets are preserved when an import has no `userPresets`.
- User presets are replaced when an import has `userPresets`.
- Module reset restores only that module's keys.
- Full reset restores all non-internal keys and preserves user presets.

Add `tests/diagnostics.test.js`:

- `Context.resourceCounts()` reports active scope counts.
- `Diagnostics.refresh()` writes resources into `diagnostics-json`.
- Disabled modules disappear from resource counts.

Add `tests/desktop-external.test.js`:

- Notification mute snapshots and restores.
- A changed external value is not overwritten on disable.
- Window button layout snapshots and restores.
- A changed button layout is not overwritten on disable.

Extend `tests/headless-install-probe.sh`:

- Assert every new schema key exists.
- Assert the packaged zip contains the new preset, diagnostics, and
  About page files.
- Keep the existing install and removal checks.

`make check` remains the gate and must end with `PROBE_OK`.

## Packaging

No new build system is needed. The existing `pack` target includes
`extension/` recursively. The headless probe is the packaging
verification for this phase.

`README.md` and `DESIGN.md` are updated after implementation to describe
presets, export/import, reset, diagnostics, and the new desktop
settings.

## Acceptance Criteria

- All five built-in presets apply deterministically and survive a
  module reload.
- A user can save the current settings as a named preset, apply it, and
  delete it.
- Export produces readable JSON. Import restores valid settings,
  preserves user presets when absent from the file, and reports skipped
  keys.
- Per-module reset restores only that module. Full reset restores every
  user-facing setting and keeps user presets.
- The diagnostics page shows live module status, per-module signal and
  source counts, and the last 20 log entries.
- The workspace indicator appears only when enabled and is removed on
  disable.
- Notification mute and macOS window controls restore the prior external
  values on disable when the user has not changed them.
- Caffeine inhibits idle and suspend while enabled and releases the
  inhibition on disable.
- `make check` passes and ends with `PROBE_OK`.
- No module leaves a signal, source, D-Bus inhibitor, or external
  setting behind after disable.

## Risks and Assumptions

- `PanelMenu.Button` and `Main.panel.addToStatusArea` are stable public
  Shell 50 APIs.
- `Meta.WorkspaceManager` emits `workspace-added` and
  `workspace-removed`; the indicator also listens to
  `active-workspace-changed`.
- `Gio.DBus.session.call` with the SessionManager Inhibit signature is
  available from the Shell process.
- `Gtk.FileChooserNative` remains available in GTK 4 on Ubuntu 26.04.
- External desktop schemas are installed on the target system.
- The reload path may briefly flicker panel and dock modules; this is
  acceptable after a preset, import, or reset.
