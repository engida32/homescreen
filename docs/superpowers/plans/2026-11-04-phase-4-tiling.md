# Phase 4: Tiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in keyboard tiling for halves, quarters, and full-width layouts with configurable gaps, and block the module while Tiling Assistant is active.

**Architecture:** Pure geometry lives in `tilingGeometry.js` and is tested headlessly. `TilingModule` binds configurable shortcuts through `Main.wm.addKeybinding`, reads the focused window and its monitor work area, and applies the rect with `Meta.Window.move_frame` plus `move_resize_frame`. The registry already blocks a `tiling` module when `tiling-assistant@ubuntu.com` is active. Drag-to-snap previews are deferred because Mutter's tile preview and window-drag pipeline are private.

**Tech Stack:** GJS, GNOME Shell 50.1, Meta window APIs, GSettings, GTK4/Adw preferences, GPLv3.

**Spec:** `DESIGN.md`

## Implementation corrections

These were verified while executing the plan and supersede the snippets below:

- `assertEqual` uses strict identity, so object rects need a local `assertRect` helper using `JSON.stringify`.
- GSettings `as` defaults containing accelerators need CDATA around the `<Super>` markers.
- Tiling Assistant on GNOME Shell 50.1 uses `move_to_monitor`, `move_frame`, then `move_resize_frame`; the module follows that order.
- `Meta.Window.get_maximize_flags()` returns the current flags, and `unmaximize(flags)` uses those flags directly.
- The work-area lookup falls back to `get_work_area_current_monitor()` when the per-monitor rect is unavailable.

## Global Constraints

- GNOME Shell 50.1 on Wayland only. Metadata `shell-version` stays `["50"]`.
- UUID: `homescreen@engida32.github.io`. Schema: `org.gnome.shell.extensions.homescreen`.
- No synchronous file I/O or synchronous D-Bus on the Shell main loop.
- Every signal, timeout, and actor is owned by a module scope. Keybindings are removed in `disable()`.
- Never silently disable another extension. The Tiling page explains the Tiling Assistant conflict and offers one-click disable.
- Private Shell APIs need a comment naming GNOME Shell 50.1 and the verified file.
- Tiling is disabled by default and only applies to the focused normal window on its current monitor and workspace.
- `make check` must stay green after every task.

## Review Focus

- A missing, non-normal, skipped, or unmovable focused window must be a no-op, not an exception.
- Maximized and fullscreen windows must leave those states before geometry is applied.
- Multi-monitor windows must use the window's monitor work area, not the primary monitor.
- A gap larger than a tiny work area must clamp so every rect has positive width and height.
- Unknown layouts and stale shortcut bindings must fail visibly during development and cleanly at disable time.
- Drag-to-snap preview is intentionally absent; the docs must say so instead of implying stock snap assist.

---

### Task 1: Pure snap geometry

**Files:**
- Create: `extension/src/modules/tiling/tilingGeometry.js`
- Create: `tests/tiling.test.js`

**Interfaces:**
- Produces: `LAYOUTS`, `TILING_SHORTCUTS`, `snapRect(workArea, layout, gap = 0)`.
- `snapRect` accepts `{x, y, width, height}` and returns `{x, y, width, height}` integers.

- [ ] **Step 1: Write the failing geometry test**

```javascript
import {LAYOUTS, TILING_SHORTCUTS, snapRect} from '../extension/src/modules/tiling/tilingGeometry.js';
import {assert, assertEqual} from './helpers.js';

const work = {x: 0, y: 0, width: 1920, height: 1080};

assertEqual(snapRect(work, 'half-left', 8),
    {x: 8, y: 8, width: 948, height: 1064}, 'left half uses a uniform gap');
assertEqual(snapRect(work, 'half-right', 8),
    {x: 964, y: 8, width: 948, height: 1064}, 'right half mirrors the left half');
assertEqual(snapRect(work, 'half-top', 8),
    {x: 8, y: 8, width: 1904, height: 528}, 'top half spans the work area');
assertEqual(snapRect(work, 'half-bottom', 8),
    {x: 8, y: 544, width: 1904, height: 528}, 'bottom half mirrors the top half');
assertEqual(snapRect(work, 'quarter-top-left', 8),
    {x: 8, y: 8, width: 948, height: 528}, 'top-left quarter');
assertEqual(snapRect(work, 'quarter-top-right', 8),
    {x: 964, y: 8, width: 948, height: 528}, 'top-right quarter');
assertEqual(snapRect(work, 'quarter-bottom-left', 8),
    {x: 8, y: 544, width: 948, height: 528}, 'bottom-left quarter');
assertEqual(snapRect(work, 'quarter-bottom-right', 8),
    {x: 964, y: 544, width: 948, height: 528}, 'bottom-right quarter');
assertEqual(snapRect(work, 'full', 8),
    {x: 8, y: 8, width: 1904, height: 1064}, 'full layout keeps the outer gap');

assertEqual(snapRect(work, 'half-left', 0),
    {x: 0, y: 0, width: 960, height: 1080}, 'zero gap fills the work area');
assertEqual(snapRect(work, 'half-left', -8),
    {x: 0, y: 0, width: 960, height: 1080}, 'negative gap is clamped to zero');

const offset = {x: 100, y: 50, width: 1921, height: 1081};
assertEqual(snapRect(offset, 'quarter-bottom-right', 8),
    {x: 1064, y: 594, width: 948, height: 528}, 'offset and odd sizes are handled');

const tiny = {x: 0, y: 0, width: 20, height: 20};
const tinyRect = snapRect(tiny, 'half-left', 100);
assertEqual(tinyRect, {x: 6, y: 6, width: 1, height: 8},
    'oversized gap clamps and keeps positive geometry');

assertEqual(LAYOUTS.length, 9, 'all layouts are listed');
for (const layout of LAYOUTS) {
    assert(TILING_SHORTCUTS[`tiling-${layout}-shortcut`] === layout ||
        Object.values(TILING_SHORTCUTS).includes(layout),
        `shortcut mapping covers ${layout}`);
}

let threw = false;
try {
    snapRect(work, 'diagonal', 8);
} catch {
    threw = true;
}
assert(threw, 'unknown layouts throw');

print('tiling tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory \
    gjs -m tests/tiling.test.js
```

Expected: FAIL because `tilingGeometry.js` does not exist.

- [ ] **Step 3: Write the geometry module**

```javascript
export const LAYOUTS = [
    'half-left',
    'half-right',
    'half-top',
    'half-bottom',
    'quarter-top-left',
    'quarter-top-right',
    'quarter-bottom-left',
    'quarter-bottom-right',
    'full',
];

export const TILING_SHORTCUTS = {
    'tiling-half-left-shortcut': 'half-left',
    'tiling-half-right-shortcut': 'half-right',
    'tiling-half-top-shortcut': 'half-top',
    'tiling-half-bottom-shortcut': 'half-bottom',
    'tiling-quarter-top-left-shortcut': 'quarter-top-left',
    'tiling-quarter-top-right-shortcut': 'quarter-top-right',
    'tiling-quarter-bottom-left-shortcut': 'quarter-bottom-left',
    'tiling-quarter-bottom-right-shortcut': 'quarter-bottom-right',
    'tiling-full-shortcut': 'full',
};

export function snapRect(workArea, layout, gap = 0) {
    const x = Math.round(workArea.x ?? 0);
    const y = Math.round(workArea.y ?? 0);
    const width = Math.max(1, Math.floor(workArea.width ?? 0));
    const height = Math.max(1, Math.floor(workArea.height ?? 0));

    const requestedGap = Math.floor(Number(gap) || 0);
    const maxGap = Math.min(
        Math.floor((width - 2) / 3),
        Math.floor((height - 2) / 3)
    );
    const g = Math.max(0, Math.min(requestedGap, maxGap));

    const halfWidth = Math.max(1, Math.floor((width - 3 * g) / 2));
    const halfHeight = Math.max(1, Math.floor((height - 3 * g) / 2));
    const fullWidth = Math.max(1, width - 2 * g);
    const fullHeight = Math.max(1, height - 2 * g);

    const left = x + g;
    const top = y + g;
    const right = x + 2 * g + halfWidth;
    const bottom = y + 2 * g + halfHeight;

    switch (layout) {
    case 'half-left':
        return {x: left, y: top, width: halfWidth, height: fullHeight};
    case 'half-right':
        return {x: right, y: top, width: halfWidth, height: fullHeight};
    case 'half-top':
        return {x: left, y: top, width: fullWidth, height: halfHeight};
    case 'half-bottom':
        return {x: left, y: bottom, width: fullWidth, height: halfHeight};
    case 'quarter-top-left':
        return {x: left, y: top, width: halfWidth, height: halfHeight};
    case 'quarter-top-right':
        return {x: right, y: top, width: halfWidth, height: halfHeight};
    case 'quarter-bottom-left':
        return {x: left, y: bottom, width: halfWidth, height: halfHeight};
    case 'quarter-bottom-right':
        return {x: right, y: bottom, width: halfWidth, height: halfHeight};
    case 'full':
        return {x: left, y: top, width: fullWidth, height: fullHeight};
    default:
        throw new Error(`Unknown tiling layout: ${layout}`);
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory \
    gjs -m tests/tiling.test.js
```

Expected: `tiling tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/tiling/tilingGeometry.js tests/tiling.test.js
git commit -m "feat: add tiling snap geometry"
```

---

### Task 2: Settings keys and conflict coverage

**Files:**
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`
- Modify: `tests/tiling.test.js`
- Modify: `tests/conflicts.test.js`

**Interfaces:**
- Produces: `tiling-enabled` boolean, `tiling-gap` integer, and nine `tiling-*-shortcut` string arrays.
- Consumes: existing `KNOWN_CONFLICTS.tiling` mapping.

- [ ] **Step 1: Add failing settings and conflict assertions**

Append to `tests/tiling.test.js` before `print('tiling tests passed');`:

```javascript
import Gio from 'gi://Gio';

const schema = Gio.SettingsSchemaSource.get_default()
    .lookup('org.gnome.shell.extensions.homescreen', true);
const settings = new Gio.Settings({settings_schema: schema});
assertEqual(settings.get_boolean('tiling-enabled'), false, 'tiling starts off');
assertEqual(settings.get_int('tiling-gap'), 8, 'tiling gap default');
assertEqual(settings.get_strv('tiling-half-left-shortcut')[0], '<Super><Control>Left',
    'half-left shortcut default');
assertEqual(settings.get_strv('tiling-quarter-top-left-shortcut')[0],
    '<Super><Control><Alt>1', 'quarter shortcut default');
assertEqual(settings.get_strv('tiling-full-shortcut')[0], '<Super><Control><Alt>f',
    'full shortcut default');
```

Add to `tests/conflicts.test.js` after the dock conflict assertion:

```javascript
assertEqual(KNOWN_CONFLICTS.tiling[0].uuid, 'tiling-assistant@ubuntu.com',
    'Tiling Assistant is the tiling conflict');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
glib-compile-schemas extension/schemas
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory \
    gjs -m tests/tiling.test.js
```

Expected: FAIL with `Settings schema 'org.gnome.shell.extensions.homescreen' does not contain a key named 'tiling-enabled'`.

- [ ] **Step 3: Add the schema keys**

Insert after the `visual-blur-brightness` key and before `diagnostics-json`:

```xml
    <key name="tiling-enabled" type="b">
      <default>false</default>
      <summary>Enable keyboard tiling</summary>
    </key>
    <key name="tiling-gap" type="i">
      <default>8</default>
      <range min="0" max="32"/>
      <summary>Gap between tiled windows and screen edges</summary>
    </key>
    <key name="tiling-half-left-shortcut" type="as">
      <default><![CDATA[['<Super><Control>Left']]]></default>
      <summary>Tile the focused window to the left half</summary>
    </key>
    <key name="tiling-half-right-shortcut" type="as">
      <default><![CDATA[['<Super><Control>Right']]]></default>
      <summary>Tile the focused window to the right half</summary>
    </key>
    <key name="tiling-half-top-shortcut" type="as">
      <default><![CDATA[['<Super><Control>Up']]]></default>
      <summary>Tile the focused window to the top half</summary>
    </key>
    <key name="tiling-half-bottom-shortcut" type="as">
      <default><![CDATA[['<Super><Control>Down']]]></default>
      <summary>Tile the focused window to the bottom half</summary>
    </key>
    <key name="tiling-quarter-top-left-shortcut" type="as">
      <default><![CDATA[['<Super><Control><Alt>1']]]></default>
      <summary>Tile the focused window to the top-left quarter</summary>
    </key>
    <key name="tiling-quarter-top-right-shortcut" type="as">
      <default><![CDATA[['<Super><Control><Alt>2']]]></default>
      <summary>Tile the focused window to the top-right quarter</summary>
    </key>
    <key name="tiling-quarter-bottom-left-shortcut" type="as">
      <default><![CDATA[['<Super><Control><Alt>3']]]></default>
      <summary>Tile the focused window to the bottom-left quarter</summary>
    </key>
    <key name="tiling-quarter-bottom-right-shortcut" type="as">
      <default><![CDATA[['<Super><Control><Alt>4']]]></default>
      <summary>Tile the focused window to the bottom-right quarter</summary>
    </key>
    <key name="tiling-full-shortcut" type="as">
      <default><![CDATA[['<Super><Control><Alt>f']]]></default>
      <summary>Tile the focused window to the full work area</summary>
    </key>
```

- [ ] **Step 4: Run both tests to verify they pass**

Run:

```bash
glib-compile-schemas extension/schemas
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory \
    gjs -m tests/tiling.test.js
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory \
    gjs -m tests/conflicts.test.js
```

Expected: `tiling tests passed` and `conflict tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml \
    tests/tiling.test.js tests/conflicts.test.js
git commit -m "feat: add tiling settings and conflict coverage"
```

---

### Task 3: Tiling module and registration

**Files:**
- Create: `extension/src/modules/tiling/tilingModule.js`
- Modify: `extension/extension.js`

**Interfaces:**
- Consumes: `TILING_SHORTCUTS`, `snapRect` from Task 1, and the tiling settings from Task 2.
- Produces: `TilingModule` with `enable(context)` and `disable()`.

- [ ] **Step 1: Write the module**

```javascript
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapRect, TILING_SHORTCUTS} from './tilingGeometry.js';

export class TilingModule {
    constructor() {
        this._settings = null;
        this._logger = null;
        this._keys = [];
    }

    enable(context) {
        this._settings = context.settings;
        this._logger = context.logger;

        try {
            for (const [key, layout] of Object.entries(TILING_SHORTCUTS)) {
                Main.wm.addKeybinding(
                    key,
                    this._settings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL,
                    () => this._apply(layout)
                );
                this._keys.push(key);
            }
        } catch (error) {
            this._unbind();
            this._settings = null;
            this._logger = null;
            throw error;
        }
    }

    _apply(layout) {
        if (!this._settings)
            return;

        try {
            const window = global.display.get_focus_window();
            if (!window || window.is_skip_taskbar())
                return;
            if (window.get_window_type() !== Meta.WindowType.NORMAL)
                return;

            const flags = window.get_maximize_flags();
            if (flags)
                window.unmaximize(flags);
            if (window.is_fullscreen())
                window.unmake_fullscreen();

            if (!window.allows_move() || !window.allows_resize())
                return;

            window.unminimize();

            const monitor = window.get_monitor() >= 0
                ? window.get_monitor()
                : global.display.get_current_monitor();
            const workArea = window.get_work_area_for_monitor(monitor) ??
                window.get_work_area_current_monitor();
            if (!workArea)
                return;

            const rect = snapRect(
                workArea,
                layout,
                this._settings.get_int('tiling-gap')
            );

            // GNOME Shell 50.1 /usr/lib/gnome-shell/libshell-18.so uses this
            // move_to_monitor plus move_frame plus move_resize_frame order.
            window.move_to_monitor(monitor);
            window.move_frame(true, rect.x, rect.y);
            window.move_resize_frame(true, rect.x, rect.y,
                rect.width, rect.height);
            window.raise();
        } catch (error) {
            this._logger?.error('tiling failed', error);
        }
    }

    _unbind() {
        for (const key of this._keys) {
            try {
                Main.wm.removeKeybinding(key);
            } catch {
                // The binding may not have been registered.
            }
        }
        this._keys = [];
    }

    disable() {
        this._unbind();
        this._settings = null;
        this._logger = null;
    }
}
```

- [ ] **Step 2: Register the module**

In `extension/extension.js`, import it:

```javascript
import {TilingModule} from './src/modules/tiling/tilingModule.js';
```

Add it after the visual registration:

```javascript
this._registry.add('visual', new VisualModule(), 'visual-enabled');
this._registry.add('tiling', new TilingModule(), 'tiling-enabled');
this._registry.add('desktop', new DesktopModule(), 'desktop-enabled');
```

- [ ] **Step 3: Run the full gate**

Run:

```bash
make check
```

Expected: PASS and `PROBE_OK`. The new module is imported by `extension.js`, so syntax and relative import checks cover it.

- [ ] **Step 4: Commit**

```bash
git add extension/src/modules/tiling/tilingModule.js extension/extension.js
git commit -m "feat: add keyboard tiling module"
```

---

### Task 4: Tiling preferences page

**Files:**
- Create: `extension/src/prefs/tilingPage.js`
- Modify: `extension/prefs.js`

**Interfaces:**
- Consumes: `createConflictBanner`, `revealIfEnabled`, `shortcutRow`, `spinRow`, `switchRow`.
- Produces: `buildTilingPage(window, settings)`.

- [ ] **Step 1: Write the preferences page**

```javascript
import Adw from 'gi://Adw';

import {createConflictBanner, revealIfEnabled} from './conflicts.js';
import {shortcutRow, spinRow, switchRow} from './helpers.js';

export function buildTilingPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Tiling',
        icon_name: 'view-grid-symbolic',
    });
    window.add(page);

    const conflictGroup = new Adw.PreferencesGroup({title: 'Compatibility'});
    page.add(conflictGroup);
    const conflict = createConflictBanner(
        'tiling-assistant@ubuntu.com',
        'Tiling Assistant'
    );
    conflictGroup.add(conflict);
    revealIfEnabled(conflict, 'tiling-assistant@ubuntu.com');

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'tiling-enabled', 'Enable keyboard tiling',
        'Applies when the extension is re-enabled.'));
    general.add(spinRow(settings, 'tiling-gap', 'Gap',
        'Pixels between tiled windows and screen edges.', 0, 32, 1));

    const shortcuts = new Adw.PreferencesGroup({
        title: 'Keyboard shortcuts',
        description: 'Snap the focused window. Shortcut rows are display-only.',
    });
    page.add(shortcuts);
    shortcuts.add(shortcutRow(settings, 'tiling-half-left-shortcut',
        'Left half'));
    shortcuts.add(shortcutRow(settings, 'tiling-half-right-shortcut',
        'Right half'));
    shortcuts.add(shortcutRow(settings, 'tiling-half-top-shortcut',
        'Top half'));
    shortcuts.add(shortcutRow(settings, 'tiling-half-bottom-shortcut',
        'Bottom half'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-top-left-shortcut',
        'Top-left quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-top-right-shortcut',
        'Top-right quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-bottom-left-shortcut',
        'Bottom-left quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-quarter-bottom-right-shortcut',
        'Bottom-right quarter'));
    shortcuts.add(shortcutRow(settings, 'tiling-full-shortcut',
        'Full work area'));

    return page;
}
```

- [ ] **Step 2: Add the page to the preferences window**

In `extension/prefs.js`, import it:

```javascript
import {buildTilingPage} from './src/prefs/tilingPage.js';
```

Call it after the visual page:

```javascript
buildVisualPage(window, settings);
buildTilingPage(window, settings);
buildDesktopPage(window, settings);
```

- [ ] **Step 3: Run the full gate**

Run:

```bash
make check
```

Expected: PASS and `PROBE_OK`.

- [ ] **Step 4: Commit**

```bash
git add extension/src/prefs/tilingPage.js extension/prefs.js
git commit -m "feat: add tiling preferences page"
```

---

### Task 5: Docs, limits, and final verification

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `docs/superpowers/plans/2026-11-04-phase-4-tiling.md`

**Interfaces:**
- Documents the shipped behavior and the deferred drag preview honestly.

- [ ] **Step 1: Update the README**

Change the status line to Phase 4, add this feature bullet:

```markdown
- Opt-in keyboard tiling for halves, quarters, and the full work area, with configurable gaps.
```

Change the preferences sentence to six pages and add:

```markdown
- Tiling: enable, gap, Tiling Assistant conflict, and display-only shortcut rows.
```

Add `src/modules/tiling/` to the project layout. Add the Phase 4 plan link. Rename `Phase 3 limits` to `Phase 4 limits` and add:

```markdown
- Tiling uses keyboard layouts only. Drag-to-snap previews and snap assist are deferred because Mutter's tile preview and window-drag pipeline are private.
- The gap applies to this module's layouts. Stock GNOME tiling still uses zero gaps.
- Tiling is off by default and is blocked while Tiling Assistant is enabled.
```

- [ ] **Step 2: Update the design status and tiling text**

Change the status to:

```markdown
Status: Phase 4 implemented, live verification pending
```

Replace the Tiling module paragraph with:

```markdown
### Tiling

Keyboard snap layouts for halves, quarters, and full-width windows with configurable gaps, applied to the focused normal window on its current monitor and workspace. Drag-to-snap preview and snap assist are deferred because Mutter's tile preview and window-drag pipeline are private. Disabled by default because Ubuntu Tiling Assistant is currently enabled. The conflict guard blocks the module while Tiling Assistant is active.
```

- [ ] **Step 3: Add the implementation corrections section**

Record any deviations found during implementation at the top of this plan, before `## Global Constraints`, using the same pattern as the Phase 2 and Phase 3 plans.

- [ ] **Step 4: Run the final gate**

Run:

```bash
make check
```

Expected: PASS and `PROBE_OK`.

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md docs/superpowers/plans/2026-11-04-phase-4-tiling.md
git commit -m "docs: record phase 4 tiling status"
```

---

## Self-Review

- Spec coverage: keyboard snap layouts and gaps (Tasks 1 and 3), Tiling Assistant conflict (Task 2 and 4), preferences (Task 4), docs and deferral (Task 5).
- Placeholders: none. Every task carries a command and an expected result.
- Type consistency: `snapRect`, `LAYOUTS`, `TILING_SHORTCUTS`, `TilingModule`, and `buildTilingPage` are defined once and used by later tasks.
- Review focus coverage: null and non-normal windows (Task 3 guarded), maximized and fullscreen windows (Task 3), multi-monitor work areas (Task 3), oversized gaps (Task 1 tiny case), unknown layouts (Task 1 throw), stale bindings (Task 3 `_unbind`), drag preview deferral (Task 5).

## Known deferrals

- Drag-to-snap previews and snap assist: Mutter emits `show-tile-preview` from private window-drag code. Replacing that pipeline is not a bounded change and stays deferred.
- Per-window gap overrides, tile groups, and tiling popups are out of scope.
- Live Wayland verification remains manual because a freshly installed extension requires logout and login.
