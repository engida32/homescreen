# Phase 2: Session Guard, Conflict Guard, Dock v2, Lockscreen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the extension in both the user and unlock-dialog session modes, block overlapping extensions instead of fighting them, make the dock work on the left, right, and bottom edges, and add a minimal Cupertino-style lockscreen module.

**Architecture:** The registry becomes session-mode aware and owns enable/disable transitions. A small conflict table blocks only the module that overlaps an active extension and records the reason in diagnostics. Dock geometry stays pure and gains an edge parameter; the module reads that parameter for orientation, position, reveal, and magnification. The lockscreen module activates only in `unlock-dialog`, decorates the existing Shell unlock dialog, and restores every patched field on disable.

**Tech Stack:** GJS, GNOME Shell 50.1, GSettings, GTK4/Adw preferences, GPLv3.

**Spec:** `DESIGN.md`

## Implementation corrections

These were verified while executing the plan and supersede the snippets below:

- The live extension D-Bus object path is `/org/gnome/Shell/Extensions`, not `/org/gnome/Shell`.
- `ListExtensions` nested values are GVariant; use `recursiveUnpack()` before reading `enabled`.
- `Adw.PreferencesPage.add()` accepts only `Adw.PreferencesGroup`; wrap an `Adw.Banner` in a group.
- Lockscreen clock updates must connect to `_clock._wallClock::notify::clock`; wrapping `_updateClock` after construction does not affect the bound handler.
- Right and bottom edge tests use inclusive `>=` so the full two-pixel reveal strip is active.
- Vertical magnification pivots at x=0 for a left dock and x=1 for a right dock.

## Global Constraints

- GNOME Shell 50.1 on Wayland only. Metadata `shell-version` stays `["50"]`.
- UUID: `homescreen@engida32.github.io`. Schema: `org.gnome.shell.extensions.homescreen`.
- No synchronous file I/O or synchronous D-Bus on the Shell main loop.
- Every signal, timeout, and actor is owned by a `ModuleScope` and released in `disable()`.
- Never silently disable another extension. Detect, explain, and offer a one-click disable action.
- Private Shell APIs need a comment naming GNOME Shell 50.1 and the verified file.
- `make check` must stay green after every task.

## Review Focus

- Locking while a module is enabled must disable it before the unlock dialog appears; unlocking must re-enable it without duplicate scopes.
- A conflict that appears after enable must block the module on the next sync, not leave the old actor alive.
- Dock reveal, intellihide, magnification, and window overlap must follow the selected edge, not the bottom edge.
- Disabling the lockscreen module must delete every patched property and actor it added.
- A missing private field or a lock-screen signal race must log and disable the module instead of throwing into the Shell.

---

### Task 1: Session-aware module registry

**Files:**
- Modify: `extension/src/core/context.js`
- Modify: `extension/src/core/registry.js`
- Create: `tests/session-mode.test.js`

**Interfaces:**
- Consumes: `Context(extension, settings, {sessionMode = null, extensionManager = null} = {})`
- Produces: `Context.currentMode: string`, `Context.extensionManager: object|null`
- Produces: `ModuleRegistry.add(id, module, enabledKey = null, {sessionModes = ['user']} = {})`
- Produces: `ModuleRegistry.sync()`, `ModuleRegistry.enableAll()`, `ModuleRegistry.disableAll()`

- [ ] **Step 1: Write the failing test**

Create `tests/session-mode.test.js`:

```javascript
import Gio from 'gi://Gio';

import {Context} from '../extension/src/core/context.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {assertEqual} from './helpers.js';

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
if (!schema)
    throw new Error('schema not compiled; run make schemas first');
const settings = new Gio.Settings({settings_schema: schema});
settings.set_boolean('panel-enabled', true);

const sessionMode = {currentMode: 'user'};
const log = [];
const context = new Context({uuid: 'test'}, settings, {sessionMode});
const registry = new ModuleRegistry(context);

const userModule = {
    enable() { log.push('user-enable'); },
    disable() { log.push('user-disable'); },
};
const lockModule = {
    enable() { log.push('lock-enable'); },
    disable() { log.push('lock-disable'); },
};

registry.add('user', userModule, 'panel-enabled');
registry.add('lockscreen', lockModule, null, {sessionModes: ['unlock-dialog']});

registry.enableAll();
assertEqual(log.join(','), 'user-enable', 'only user modules enable in user mode');

sessionMode.currentMode = 'unlock-dialog';
registry.sync();
assertEqual(log.join(','), 'user-enable,user-disable,lock-enable',
    'sync swaps user modules for unlock-dialog modules');
assertEqual(registry.status('user'), 'disabled', 'user module is disabled');
assertEqual(registry.status('lockscreen'), 'enabled', 'lockscreen module is enabled');

sessionMode.currentMode = 'user';
registry.sync();
assertEqual(log.join(','), 'user-enable,user-disable,lock-enable,lock-disable,user-enable',
    'sync swaps back without duplicate enable');
assertEqual(context.scopeCount, 1, 'one scope remains for the active module');

registry.disableAll();
assertEqual(log[log.length - 1], 'user-disable', 'disableAll disables the active module');
assertEqual(context.scopeCount, 0, 'all scopes are released');

print('session mode tests passed');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/session-mode.test.js
```

Expected: `TypeError: registry.sync is not a function` or the first assertion fails because the lockscreen module enabled too.

- [ ] **Step 3: Add session mode to Context**

Modify `extension/src/core/context.js`:

```javascript
export class Context {
    constructor(extension, settings, options = {}) {
        this.extension = extension;
        this.settings = settings;
        this.sessionMode = options.sessionMode ?? null;
        this.extensionManager = options.extensionManager ?? null;
        this.logger = new Logger();
        this.diagnostics = new Diagnostics(settings, this.logger);
        this._modules = new Map();
        this._scopes = new Set();
    }

    get currentMode() {
        return this.sessionMode?.currentMode ?? 'user';
    }
```

Keep every existing method and getter unchanged.

- [ ] **Step 4: Make the registry session-aware**

Modify `extension/src/core/registry.js`:

```javascript
add(id, module, enabledKey = null, options = {}) {
    this._entries.push({
        id,
        module,
        enabledKey,
        sessionModes: options.sessionModes ?? ['user'],
    });
    this._context.registerModule(id, module);
}

enableAll() {
    for (const entry of this._entries)
        this._enable(entry);
}

sync() {
    const mode = this._context.currentMode;

    for (const {entry, scope} of [...this._enabled]) {
        if (entry.sessionModes.includes(mode))
            continue;
        this._disable(entry, scope);
        this._enabled = this._enabled.filter(item => item.entry !== entry);
    }

    for (const entry of this._entries) {
        if (!entry.sessionModes.includes(mode))
            continue;
        if (this._enabled.some(item => item.entry === entry))
            continue;
        this._enable(entry);
    }
}

_enable(entry) {
    if (!entry.sessionModes.includes(this._context.currentMode))
        return;

    if (entry.enabledKey &&
        !this._context.settings.get_boolean(entry.enabledKey)) {
        this._context.diagnostics.setModule(entry.id, 'disabled', 'settings');
        return;
    }

    const scope = this._context.scope(entry.id);
    const moduleContext = {
        extension: this._context.extension,
        settings: this._context.settings,
        logger: this._context.logger,
        diagnostics: this._context.diagnostics,
        scope,
        getModule: id => this._context.getModule(id),
    };

    try {
        entry.module.enable(moduleContext);
        this._enabled.push({entry, scope});
        this._context.diagnostics.setModule(entry.id, 'enabled');
        this._context.logger.info(`${entry.id} enabled`);
    } catch (error) {
        this._context.logger.error(`${entry.id} failed to enable`, error);
        this._context.diagnostics.setModule(entry.id, 'failed', error.message);
        this._context.releaseScope(scope);
    }
}

_disable(entry, scope) {
    try {
        entry.module.disable();
    } catch (error) {
        this._context.logger.error(`${entry.id} failed to disable`, error);
    } finally {
        this._context.releaseScope(scope);
        this._context.diagnostics.setModule(entry.id, 'disabled');
    }
}

disableAll() {
    for (const {entry, scope} of this._enabled.reverse())
        this._disable(entry, scope);
    this._enabled = [];
}
```

- [ ] **Step 5: Run the test and the registry test**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/session-mode.test.js
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/registry.test.js
```

Expected: both print their pass line.

- [ ] **Step 6: Commit**

```bash
git add extension/src/core/context.js extension/src/core/registry.js tests/session-mode.test.js
git commit -m "feat: make module registry session-aware"
```

---

### Task 2: Conflict guard core

**Files:**
- Create: `extension/src/core/conflicts.js`
- Modify: `extension/src/core/registry.js`
- Create: `tests/conflicts.test.js`

**Interfaces:**
- Consumes: `findActiveConflicts(moduleId, lookup)`
- Produces: `KNOWN_CONFLICTS: Record<string, Array<{uuid: string, name: string}>>`
- Produces: registry status `'blocked'` with a detail string naming the extension.

- [ ] **Step 1: Write the failing test**

Create `tests/conflicts.test.js`:

```javascript
import Gio from 'gi://Gio';

import {Context} from '../extension/src/core/context.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {findActiveConflicts, KNOWN_CONFLICTS} from '../extension/src/core/conflicts.js';
import {assert, assertEqual} from './helpers.js';

assertEqual(KNOWN_CONFLICTS.dock[0].uuid, 'ubuntu-dock@ubuntu.com',
    'Ubuntu Dock is the dock conflict');

const active = findActiveConflicts('dock', uuid => ({
    state: uuid === 'ubuntu-dock@ubuntu.com' ? 1 : 2,
}));
assertEqual(active.length, 1, 'one active conflict is found');
assertEqual(active[0].name, 'Ubuntu Dock', 'the conflict name is readable');

const inactive = findActiveConflicts('dock', () => ({state: 2}));
assertEqual(inactive.length, 0, 'inactive extensions do not conflict');

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
const settings = new Gio.Settings({settings_schema: schema});
settings.set_boolean('dock-enabled', true);

const context = new Context({uuid: 'test'}, settings, {
    extensionManager: {
        lookup: uuid => ({
            state: uuid === 'ubuntu-dock@ubuntu.com' ? 1 : 2,
        }),
    },
});
const registry = new ModuleRegistry(context);
let dockEnabled = false;
registry.add('dock', {
    enable() { dockEnabled = true; },
    disable() { dockEnabled = false; },
}, 'dock-enabled');

registry.enableAll();
assertEqual(dockEnabled, false, 'conflicted dock stays off');
assertEqual(registry.status('dock'), 'blocked', 'conflict is recorded');
assert(context.snapshot().modules.dock.detail.includes('Ubuntu Dock'),
    'conflict detail names the extension');

print('conflict tests passed');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/conflicts.test.js
```

Expected: module not found for `conflicts.js`.

- [ ] **Step 3: Implement the conflict table and lookup**

Create `extension/src/core/conflicts.js`:

```javascript
export const KNOWN_CONFLICTS = {
    dock: [
        {uuid: 'ubuntu-dock@ubuntu.com', name: 'Ubuntu Dock'},
    ],
    tiling: [
        {uuid: 'tiling-assistant@ubuntu.com', name: 'Tiling Assistant'},
    ],
};

export function findActiveConflicts(moduleId, lookup) {
    const entries = KNOWN_CONFLICTS[moduleId] ?? [];
    return entries.filter(entry => lookup(entry.uuid)?.state === 1);
}

export function conflictDetail(conflicts) {
    return conflicts.map(conflict => conflict.name).join(', ');
}
```

- [ ] **Step 4: Block conflicted modules in the registry**

In `extension/src/core/registry.js`, import the helpers:

```javascript
import {conflictDetail, findActiveConflicts} from './conflicts.js';
```

In `_enable(entry)`, after the settings check, add:

```javascript
    const conflicts = this._context.extensionManager
        ? findActiveConflicts(entry.id, uuid => this._context.extensionManager.lookup(uuid))
        : [];
    if (conflicts.length > 0) {
        this._context.diagnostics.setModule(entry.id, 'blocked', conflictDetail(conflicts));
        this._context.logger.info(`${entry.id} blocked by ${conflictDetail(conflicts)}`);
        return;
    }
```

In `sync()`, before re-enabling, disable any enabled entry that now has conflicts:

```javascript
    const conflicts = this._context.extensionManager
        ? findActiveConflicts(entry.id, uuid => this._context.extensionManager.lookup(uuid))
        : [];
    if (conflicts.length > 0) {
        this._disable(entry, scope);
        this._enabled = this._enabled.filter(item => item.entry !== entry);
    }
```

Place that block inside the first loop, after the session-mode `continue`.

- [ ] **Step 5: Run the test and the session test**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/conflicts.test.js
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/session-mode.test.js
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add extension/src/core/conflicts.js extension/src/core/registry.js tests/conflicts.test.js
git commit -m "feat: block known extension conflicts"
```

---

### Task 3: Dock geometry for left and right edges

**Files:**
- Modify: `extension/src/modules/dock/layout.js`
- Modify: `tests/dock-layout.test.js`

**Interfaces:**
- Produces: `dockBounds(position, monitor, count, iconSize, spacing, padding, margin) -> {x, y, width, height}`
- Produces: `hiddenDockPosition(position, monitor, margin, bounds) -> {x, y}`
- Produces: `pointerAtDockEdge(position, monitor, pointerX, pointerY, threshold = 2) -> boolean`
- Produces: `slotCenterForAxis(index, iconSize, spacing, padding, vertical) -> number`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dock-layout.test.js`:

```javascript
import {
    dockBounds,
    hiddenDockPosition,
    pointerAtDockEdge,
    slotCenterForAxis,
} from '../extension/src/modules/dock/layout.js';

const leftMonitor = {x: 0, y: 0, width: 1000, height: 800};
const left = dockBounds('left', leftMonitor, 3, 52, 8, 10, 10);
assertEqual(left.x, 10, 'left dock starts at the left margin');
assertEqual(left.width, 82, 'left dock thickness includes icon, padding, and indicator');
assertEqual(left.height, 192, 'left dock length is three icons plus spacing');
assertEqual(left.y, 304, 'left dock is vertically centered');

const right = dockBounds('right', leftMonitor, 1, 52, 8, 10, 10);
assertEqual(right.x, 908, 'right dock starts at the right edge minus width and margin');
assertEqual(right.width, 82, 'right dock thickness is stable');
assertEqual(right.y, 364, 'single icon is centered vertically');

const hiddenLeft = hiddenDockPosition('left', leftMonitor, 10, left);
assertEqual(hiddenLeft.x, -80, 'hidden left dock leaves a two pixel strip');
assertEqual(hiddenLeft.y, 304, 'hidden left dock keeps its centered y');

const hiddenRight = hiddenDockPosition('right', leftMonitor, 10, right);
assertEqual(hiddenRight.x, 998, 'hidden right dock leaves a two pixel strip');

assert(pointerAtDockEdge('left', leftMonitor, 1, 400), 'left edge is detected');
assert(pointerAtDockEdge('right', leftMonitor, 999, 400), 'right edge is detected');
assert(pointerAtDockEdge('bottom', leftMonitor, 500, 799), 'bottom edge is detected');
assert(!pointerAtDockEdge('left', leftMonitor, 20, 400), 'inside the monitor is not the edge');

assertEqual(slotCenterForAxis(0, 52, 8, 10, false), 36, 'horizontal slot');
assertEqual(slotCenterForAxis(1, 52, 8, 10, true), 96, 'vertical slot');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
gjs -m tests/dock-layout.test.js
```

Expected: import error because the new functions do not exist.

- [ ] **Step 3: Implement the geometry**

Append to `extension/src/modules/dock/layout.js`:

```javascript
export function dockLength(count, iconSize, spacing, padding) {
    return dockWidth(count, iconSize, spacing, padding);
}

export function dockThickness(iconSize, padding, indicatorSpace = 10) {
    return iconSize + padding * 2 + indicatorSpace;
}

export function dockBounds(position, monitor, count, iconSize, spacing, padding, margin) {
    const length = dockLength(count, iconSize, spacing, padding);
    const thickness = dockThickness(iconSize, padding);

    if (position === 'left') {
        return {
            x: monitor.x + margin,
            y: monitor.y + Math.round((monitor.height - length) / 2),
            width: thickness,
            height: length,
        };
    }

    if (position === 'right') {
        return {
            x: monitor.x + monitor.width - thickness - margin,
            y: monitor.y + Math.round((monitor.height - length) / 2),
            width: thickness,
            height: length,
        };
    }

    return {
        x: monitor.x + Math.round((monitor.width - length) / 2),
        y: monitor.y + monitor.height - thickness - margin,
        width: length,
        height: thickness,
    };
}

export function hiddenDockPosition(position, monitor, margin, bounds) {
    if (position === 'left')
        return {x: monitor.x - bounds.width + 2, y: bounds.y};
    if (position === 'right')
        return {x: monitor.x + monitor.width - 2, y: bounds.y};
    return {x: bounds.x, y: monitor.y + monitor.height - 2};
}

export function pointerAtDockEdge(position, monitor, x, y, threshold = 2) {
    if (position === 'left')
        return x >= monitor.x && x < monitor.x + threshold &&
            y >= monitor.y && y < monitor.y + monitor.height;
    if (position === 'right')
        return x > monitor.x + monitor.width - threshold && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height;
    return y > monitor.y + monitor.height - threshold && y < monitor.y + monitor.height &&
        x >= monitor.x && x < monitor.x + monitor.width;
}

export function slotCenterForAxis(index, iconSize, spacing, padding, vertical) {
    return slotCenter(index, iconSize, spacing, padding);
}
```

The hidden position needs the real dock bounds so the reveal strip stays at two pixels and the dock keeps its centered coordinate.

- [ ] **Step 4: Run the geometry test**

Run:

```bash
gjs -m tests/dock-layout.test.js
```

Expected: `dock layout tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/dock/layout.js tests/dock-layout.test.js
git commit -m "feat: add dock edge geometry"
```

---

### Task 4: Wire dock v2 into the module and preferences

**Files:**
- Modify: `extension/src/modules/dock/dockModule.js`
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`
- Modify: `extension/src/prefs/dockPage.js`
- Modify: `extension/stylesheet.css`

**Interfaces:**
- Consumes: `dockBounds`, `hiddenDockPosition`, `pointerAtDockEdge`, `slotCenterForAxis`
- Produces: `dock-position` accepts `bottom`, `left`, `right`.

- [ ] **Step 1: Add the failing schema assertion to the test suite**

Add to `tests/dock-layout.test.js`:

```javascript
import Gio from 'gi://Gio';

const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
const settings = new Gio.Settings({settings_schema: schema});
settings.set_string('dock-position', 'left');
assertEqual(settings.get_string('dock-position'), 'left', 'left dock position is stored');
```

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/dock-layout.test.js
```

Expected: fails because the schema rejects `left` or the value is ignored.

- [ ] **Step 2: Update the schema and preferences**

In the schema, change the `dock-position` description and default only if needed:

```xml
    <key name="dock-position" type="s">
      <default>'bottom'</default>
      <summary>Dock position</summary>
      <description>One of bottom, left, right.</description>
    </key>
```

In `extension/src/prefs/dockPage.js`, change:

```javascript
behavior.add(comboRow(settings, 'dock-position', 'Position',
    ['bottom', 'left', 'right']));
```

Change the margin subtitle:

```javascript
size.add(spinRow(settings, 'dock-margin', 'Screen margin',
    'Pixels from the screen edge.', 4, 24, 1));
```

- [ ] **Step 3: Refactor the dock module position state**

In `DockModule`, replace the `_shownY`/`_hiddenY` fields with:

```javascript
this._shown = {x: 0, y: 0};
this._hidden = {x: 0, y: 0};
this._edge = 'bottom';
this._vertical = false;
```

Replace `_isPointerAtEdge()` with:

```javascript
    _isPointerAtEdge() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const [x, y] = global.get_pointer();
        return pointerAtDockEdge(this._edge, monitor, x, y);
    }
```

Import `dockBounds`, `hiddenDockPosition`, `pointerAtDockEdge`, `slotCenterForAxis`, and keep `dockHeight`, `dockOrigin`, `dockWidth`, `hiddenDockY` only if still used. Remove unused imports.

Replace `_showDock` and `_hideDock` movement with:

```javascript
    _showDock(animate = true) {
        if (!this._container || this._forcedHidden || this._icons.length === 0)
            return;
        this._cancelHide();
        if (this._container.visible &&
            this._container.x === this._shown.x &&
            this._container.y === this._shown.y)
            return;
        this._container.remove_all_transitions();
        this._container.show();
        if (!animate) {
            this._container.set_position(this._shown.x, this._shown.y);
            return;
        }
        this._container.ease({
            x: this._shown.x,
            y: this._shown.y,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideDock(animate = true) {
        if (!this._container)
            return;
        this._cancelHide();
        if (!this._container.visible &&
            this._container.x === this._hidden.x &&
            this._container.y === this._hidden.y)
            return;
        this._container.remove_all_transitions();
        if (!animate) {
            this._container.set_position(this._hidden.x, this._hidden.y);
            this._container.hide();
            return;
        }
        this._container.ease({
            x: this._hidden.x,
            y: this._hidden.y,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._container &&
                    this._container.x === this._hidden.x &&
                    this._container.y === this._hidden.y)
                    this._container.hide();
            },
        });
    }
```

Replace `_windowsOverlapDock()` rect with:

```javascript
        const rect = {
            x: this._shown.x,
            y: this._shown.y,
            width: this._container.width,
            height: this._container.height,
        };
```

Replace `_position()` with:

```javascript
    _position() {
        if (!this._container)
            return;

        this._background.set_style(dockBackgroundStyle(
            this._settings.get_int('dock-radius'),
            this._settings.get_double('dock-opacity')));

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const iconSize = this._settings.get_int('dock-icon-size');
        const spacing = this._settings.get_int('dock-spacing');
        const padding = this._settings.get_int('dock-padding');
        const margin = this._settings.get_int('dock-margin');
        const edge = this._settings.get_string('dock-position');
        const vertical = edge === 'left' || edge === 'right';
        const bounds = dockBounds(edge, monitor, this._icons.length,
            iconSize, spacing, padding, margin);

        this._edge = edge;
        this._vertical = vertical;
        this._shown = {x: bounds.x, y: bounds.y};
        this._hidden = hiddenDockPosition(edge, monitor, margin, bounds);

        this._box.set_orientation(vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL);
        this._box.set_style(`spacing: ${spacing}px; padding: ${padding}px;`);
        this._container.set_size(bounds.width, bounds.height);

        const shown = this._shouldStayShown();
        this._container.set_position(
            shown ? this._shown.x : this._hidden.x,
            shown ? this._shown.y : this._hidden.y);
        this._container.visible = shown;
        this._updateDockVisibility();
    }
```

Add a settings signal:

```javascript
this._scope.signal(this._settings, 'changed::dock-position', () => this._position());
```

- [ ] **Step 4: Update magnification for the vertical axis**

Replace the pointer/local coordinate and pivot logic in `_updateMagnification()`:

```javascript
        const [pointerX, pointerY] = global.get_pointer();
        const local = this._vertical
            ? pointerY - this._container.y
            : pointerX - this._container.x;
        const centers = this._icons.map((_icon, index) =>
            slotCenterForAxis(index, iconSize, spacing, padding, this._vertical));
        const scales = scalesForCenters(
            local,
            centers,
            iconSize + spacing,
            this._settings.get_double('dock-magnification-strength'),
            1.4
        );
        this._icons.forEach((icon, index) => {
            const pivotX = this._vertical ? 1.0 : 0.5;
            const pivotY = this._vertical ? 0.5 : 1.0;
            icon.set_pivot_point(pivotX, pivotY);
            icon.set_scale(scales[index], scales[index]);
        });
```

Update `_resetMagnification()` the same way:

```javascript
            const pivotX = this._vertical ? 1.0 : 0.5;
            const pivotY = this._vertical ? 0.5 : 1.0;
            icon.set_pivot_point(pivotX, pivotY);
```

- [ ] **Step 5: Add vertical running-dot CSS**

Append to `extension/stylesheet.css`:

```css
.homescreen-dock-vertical .app-grid-running-dot {
    margin-bottom: 0;
    margin-right: 2px;
}
```

In `_position()`, toggle the class:

```javascript
        if (this._vertical)
            this._container.add_style_class_name('homescreen-dock-vertical');
        else
            this._container.remove_style_class_name('homescreen-dock-vertical');
```

- [ ] **Step 6: Run the layout test and the full gate**

Run:

```bash
GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/dock-layout.test.js
make check
```

Expected: layout test passes and `make check` ends with `PROBE_OK`.

- [ ] **Step 7: Commit**

```bash
git add extension/src/modules/dock/dockModule.js extension/src/modules/dock/layout.js extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml extension/src/prefs/dockPage.js extension/stylesheet.css tests/dock-layout.test.js
git commit -m "feat: support left and right dock edges"
```

---

### Task 5: Lockscreen formatting and module

**Files:**
- Create: `extension/src/modules/lockscreen/format.js`
- Create: `extension/src/modules/lockscreen/lockscreenModule.js`
- Create: `extension/src/prefs/lockscreenPage.js`
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`
- Modify: `extension/src/prefs/helpers.js` if a new row helper is needed
- Create: `tests/lockscreen-format.test.js`

**Interfaces:**
- Produces: `formatClock(dateTime, format) -> string`
- Produces: `formatDate(dateTime, format) -> string`
- Produces: `hasMessage(message) -> boolean`
- Produces: `LockscreenModule.enable(context)`, `LockscreenModule.disable()`

- [ ] **Step 1: Write the failing format test**

Create `tests/lockscreen-format.test.js`:

```javascript
import GLib from 'gi://GLib';

import {
    formatClock,
    formatDate,
    hasMessage,
} from '../extension/src/modules/lockscreen/format.js';
import {assert, assertEqual} from './helpers.js';

const date = GLib.DateTime.new_local(2026, 11, 4, 9, 5, 0);

assertEqual(formatClock(date, '%H:%M'), '09:05', 'clock format uses GLib strftime');
assertEqual(formatClock(date, '%I:%M %p'), '09:05 AM', 'clock format supports 12 hour');
assertEqual(formatDate(date, '%A, %B %-d'), 'Wednesday, November 4', 'date format');
assert(hasMessage('  Focus  '), 'trimmed non-empty message is visible');
assert(!hasMessage('   '), 'whitespace-only message is hidden');

print('lockscreen format tests passed');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
gjs -m tests/lockscreen-format.test.js
```

Expected: module not found.

- [ ] **Step 3: Implement the pure formatting**

Create `extension/src/modules/lockscreen/format.js`:

```javascript
export function formatClock(dateTime, format) {
    return dateTime.format(format) ?? '';
}

export function formatDate(dateTime, format) {
    return dateTime.format(format) ?? '';
}

export function hasMessage(message) {
    return Boolean(message?.trim());
}
```

- [ ] **Step 4: Run the format test**

Run:

```bash
gjs -m tests/lockscreen-format.test.js
```

Expected: `lockscreen format tests passed`.

- [ ] **Step 5: Add the schema keys**

Insert before the `diagnostics-json` key:

```xml
    <key name="lockscreen-enabled" type="b">
      <default>false</default>
      <summary>Enable the lockscreen module</summary>
    </key>
    <key name="lockscreen-clock-format" type="s">
      <default>'%H:%M'</default>
      <summary>Lockscreen clock format</summary>
    </key>
    <key name="lockscreen-date-format" type="s">
      <default>'%A, %B %-d'</default>
      <summary>Lockscreen date format</summary>
    </key>
    <key name="lockscreen-message" type="s">
      <default>''</default>
      <summary>Lockscreen message</summary>
    </key>
    <key name="lockscreen-wallpaper-uri" type="s">
      <default>''</default>
      <summary>Lockscreen wallpaper URI</summary>
    </key>
```

- [ ] **Step 6: Implement the lockscreen module**

Create `extension/src/modules/lockscreen/lockscreenModule.js`:

```javascript
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {formatClock, formatDate, hasMessage} from './format.js';

const GNOME_SHELL_VERSION = '50.1';

export class LockscreenModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._dialog = null;
        this._clock = null;
        this._message = null;
        this._wallpapers = [];
        this._originalUpdateClock = null;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;

        // GNOME Shell 50.1: ScreenShield emits lock-screen-shown after _dialog
        // exists. Verified in /usr/share/gnome-shell js/ui/screenShield.js.
        this._scope.signal(Main.screenShield, 'lock-screen-shown', () => this._apply());
        this._scope.signal(Main.layoutManager, 'monitors-changed', () => this._applyWallpaper());

        this._scope.signal(this._settings, 'changed::lockscreen-clock-format', () => this._refreshClock());
        this._scope.signal(this._settings, 'changed::lockscreen-date-format', () => this._refreshClock());
        this._scope.signal(this._settings, 'changed::lockscreen-message', () => this._refreshMessage());
        this._scope.signal(this._settings, 'changed::lockscreen-wallpaper-uri', () => this._applyWallpaper());

        if (Main.screenShield?.locked)
            this._apply();
    }

    _apply() {
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
        this._originalUpdateClock = this._clock._updateClock;
        this._clock._updateClock = () => {
            this._originalUpdateClock?.call(this._clock);
            this._refreshClock();
        };
        this._refreshClock();
        this._refreshMessage();
        this._applyWallpaper();
    }

    _refreshClock() {
        if (!this._clock)
            return;
        const now = GLib.DateTime.new_now_local();
        this._clock._time.text = formatClock(now, this._settings.get_string('lockscreen-clock-format'));
        this._clock._date.text = formatDate(now, this._settings.get_string('lockscreen-date-format'));
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
        if (!uri || !this._dialog)
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
        for (const widget of this._wallpapers)
            widget.destroy();
        this._wallpapers = [];
        if (this._dialog?._backgroundGroup)
            this._dialog._backgroundGroup.visible = true;
    }

    _restore() {
        this._clearWallpaper();
        if (this._message) {
            this._message.destroy();
            this._message = null;
        }
        if (this._clock) {
            if (this._originalUpdateClock)
                this._clock._updateClock = this._originalUpdateClock;
            this._clock.remove_style_class_name('homescreen-lockscreen-clock');
        }
        if (this._dialog)
            this._dialog.remove_style_class_name('homescreen-lockscreen');
        this._dialog = null;
        this._clock = null;
        this._originalUpdateClock = null;
    }

    disable() {
        this._restore();
    }
}
```

- [ ] **Step 7: Add the preferences page**

Create `extension/src/prefs/lockscreenPage.js`:

```javascript
import Adw from 'gi://Adw';

import {switchRow, textRow} from './helpers.js';

export function buildLockscreenPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Lockscreen',
        icon_name: 'system-lock-screen-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'lockscreen-enabled', 'Enable lockscreen',
        'Active only while the screen is locked. Applies when the extension is re-enabled.'));

    const clock = new Adw.PreferencesGroup({title: 'Clock'});
    page.add(clock);
    clock.add(textRow(settings, 'lockscreen-clock-format', 'Clock format',
        'GLib strftime format, for example %H:%M.'));
    clock.add(textRow(settings, 'lockscreen-date-format', 'Date format',
        'GLib strftime format, for example %A, %B %-d.'));
    clock.add(textRow(settings, 'lockscreen-message', 'Message',
        'Optional line under the date.'));

    const background = new Adw.PreferencesGroup({title: 'Background'});
    page.add(background);
    background.add(textRow(settings, 'lockscreen-wallpaper-uri', 'Wallpaper URI',
        'Optional file:// URI. Empty uses the current wallpaper.'));

    return page;
}
```

Add `textRow` to `extension/src/prefs/helpers.js`:

```javascript
export function textRow(settings, key, title, subtitle = '') {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    row.text = settings.get_string(key);
    row.connect('apply', () => settings.set_string(key, row.text));
    settings.connect(`changed::${key}`, () => {
        if (row.text !== settings.get_string(key))
            row.text = settings.get_string(key);
    });
    return row;
}
```

- [ ] **Step 8: Add lockscreen CSS**

Append to `extension/stylesheet.css`:

```css
.homescreen-lockscreen-clock-time {
    font-size: 96px;
    font-weight: 200;
    color: #ffffff;
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
}

.homescreen-lockscreen-clock-date {
    font-size: 20px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.86);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.55);
}

.homescreen-lockscreen-message {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.72);
    margin-top: 6px;
}

.homescreen-lockscreen-wallpaper {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
}
```

- [ ] **Step 9: Run the format test and the full gate**

Run:

```bash
gjs -m tests/lockscreen-format.test.js
make check
```

Expected: format test passes and `make check` ends with `PROBE_OK`.

- [ ] **Step 10: Commit**

```bash
git add extension/src/modules/lockscreen extension/src/prefs/lockscreenPage.js extension/src/prefs/helpers.js extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml extension/stylesheet.css tests/lockscreen-format.test.js
git commit -m "feat: add lockscreen module"
```

---

### Task 6: Session-mode wiring and preferences

**Files:**
- Modify: `extension/extension.js`
- Modify: `extension/prefs.js`
- Modify: `extension/metadata.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `LockscreenModule`, `ModuleRegistry.sync()`
- Produces: metadata `session-modes: ["user", "unlock-dialog"]`
- Produces: four preferences pages.

- [ ] **Step 1: Add the failing metadata assertion**

Add to `scripts/validate-metadata.py`:

```python
assert metadata.get("session-modes") == ["user", "unlock-dialog"], \
    "metadata must opt into both user and unlock-dialog session modes"
```

Run:

```bash
python3 scripts/validate-metadata.py
```

Expected: assertion error.

- [ ] **Step 2: Update metadata**

Add to `extension/metadata.json`:

```json
  "session-modes": ["user", "unlock-dialog"],
```

Place it after `settings-schema`.

- [ ] **Step 3: Wire the registry and session sync**

Replace `extension/extension.js` with:

```javascript
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Context} from './src/core/context.js';
import {ModuleRegistry} from './src/core/registry.js';
import {PanelModule} from './src/modules/panel/panelModule.js';
import {DockModule} from './src/modules/dock/dockModule.js';
import {DesktopModule} from './src/modules/desktop/desktopModule.js';
import {LockscreenModule} from './src/modules/lockscreen/lockscreenModule.js';

export default class HomescreenExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._context = new Context(this, this._settings, {
            sessionMode: Main.sessionMode,
            extensionManager: Main.extensionManager,
        });
        this._registry = new ModuleRegistry(this._context);

        this._registry.add('panel', new PanelModule(), 'panel-enabled');
        this._registry.add('dock', new DockModule(), 'dock-enabled');
        this._registry.add('desktop', new DesktopModule(), 'desktop-enabled');
        this._registry.add('lockscreen', new LockscreenModule(), 'lockscreen-enabled',
            {sessionModes: ['unlock-dialog']});

        this._sessionSignal = Main.sessionMode.connect('updated', () => this._registry.sync());
        this._registry.enableAll();
    }

    disable() {
        if (this._sessionSignal) {
            Main.sessionMode.disconnect(this._sessionSignal);
            this._sessionSignal = 0;
        }
        this._registry?.disableAll();
        this._context?.destroy();
        this._registry = null;
        this._context = null;
        this._settings = null;
    }
}
```

- [ ] **Step 4: Add the page to preferences**

In `extension/prefs.js`, import and call the page:

```javascript
import {buildLockscreenPage} from './src/prefs/lockscreenPage.js';
```

After `buildDesktopPage`:

```javascript
buildLockscreenPage(window, settings);
```

- [ ] **Step 5: Update the README**

In `README.md`, add to Features:

```markdown
- Custom lockscreen clock, date, message, and static wallpaper, active only while locked.
```

Change Phase 1 limits to Phase 2 limits:

```markdown
## Phase 2 limits

- Dock position supports bottom, left, and right; window previews and badges are not implemented.
- The lockscreen uses the current Shell unlock dialog; GDM is untouched.
- Lockscreen fade, unblank, and Esc-to-sleep remain manual checks.
- Live Wayland verification is still manual.
```

- [ ] **Step 6: Run the full gate**

Run:

```bash
make check
```

Expected: all suites pass and `PROBE_OK`.

- [ ] **Step 7: Commit**

```bash
git add extension/extension.js extension/prefs.js extension/metadata.json scripts/validate-metadata.py README.md
git commit -m "feat: run lockscreen only in unlock-dialog"
```

---

### Task 7: Conflict banner in preferences

**Files:**
- Create: `extension/src/prefs/conflicts.js`
- Modify: `extension/src/prefs/dockPage.js`

**Interfaces:**
- Produces: `watchConflicts(window, page, {uuid, name, moduleTitle})`
- Uses D-Bus `org.gnome.Shell.Extensions.DisableExtension` at `/org/gnome/Shell`.

- [ ] **Step 1: Write the helper**

Create `extension/src/prefs/conflicts.js`:

```javascript
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Shell.Extensions';
const OBJECT_PATH = '/org/gnome/Shell';
const INTERFACE = 'org.gnome.Shell.Extensions';

function call(method, params) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            BUS_NAME, OBJECT_PATH, INTERFACE, method, params, null,
            Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export async function extensionEnabled(uuid) {
    const reply = await call('ListExtensions', null);
    const [extensions] = reply.deepUnpack();
    return Boolean(extensions[uuid]?.enabled);
}

export function createConflictBanner(uuid, name) {
    const banner = new Adw.Banner({
        title: `${name} is enabled. Homescreen avoids taking over its feature.`,
        button_label: `Disable ${name}`,
        revealed: false,
    });
    banner.connect('button-clicked', () => {
        call('DisableExtension', new GLib.Variant('(s)', [uuid]))
            .then(() => {
                banner.title = `${name} is disabled. Re-enable Homescreen.`;
                banner.button_label = '';
            })
            .catch(error => {
                banner.title = `Could not disable ${name}: ${error.message}`;
            });
    });
    return banner;
}

export async function revealIfEnabled(banner, uuid) {
    try {
        banner.revealed = await extensionEnabled(uuid);
    } catch {
        banner.revealed = false;
    }
}
```

- [ ] **Step 2: Add the banner to the dock page**

In `extension/src/prefs/dockPage.js`, import:

```javascript
import {createConflictBanner, revealIfEnabled} from './conflicts.js';
```

At the top of `buildDockPage`, before the general group:

```javascript
    const conflict = createConflictBanner('ubuntu-dock@ubuntu.com', 'Ubuntu Dock');
    page.add(conflict);
    revealIfEnabled(conflict, 'ubuntu-dock@ubuntu.com');
```

- [ ] **Step 3: Run the full gate**

Run:

```bash
make check
```

Expected: all suites pass and `PROBE_OK`.

- [ ] **Step 4: Commit**

```bash
git add extension/src/prefs/conflicts.js extension/src/prefs/dockPage.js
git commit -m "feat: offer one-click conflict resolution"
```

---

### Task 8: Final verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `docs/superpowers/plans/2026-11-04-phase-2-lockscreen-dock-v2.md`

- [ ] **Step 1: Run the full gate**

Run:

```bash
make check
```

Expected: all suites pass and `PROBE_OK`.

- [ ] **Step 2: Run the live cycle script**

Run in a GNOME 50.1 Wayland session:

```bash
./scripts/cycle-extension.sh 20
```

Watch:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Record whether locking, unlocking, dock edges, conflict blocking, and disable cleanup pass. This is manual evidence.

- [ ] **Step 3: Update design status**

Change the `DESIGN.md` status line to:

```markdown
Status: Phase 2 implemented, live verification pending
```

- [ ] **Step 4: Update the README limits**

Reflect only what passed. If live lock/unlock or edge checks fail, list the failing item under limits and do not claim it works.

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md docs/superpowers/plans/2026-11-04-phase-2-lockscreen-dock-v2.md
git commit -m "docs: record phase 2 status"
```

---

## Self-Review

- Spec coverage: session guard (Task 1 and 6), conflict policy (Task 2 and 7), dock v2 edges (Task 3 and 4), lockscreen (Task 5), docs and manual matrix (Task 8).
- Placeholders: none. Every task carries a command and an expected result.
- Type consistency: `currentMode`, `sessionModes`, `sync`, `dockBounds`, `hiddenDockPosition`, `pointerAtDockEdge`, `formatClock`, `formatDate`, `hasMessage` are defined once and used by later tasks.
- Review focus coverage: session swap race (Task 1 test), late conflict (Task 2 sync), dock edge behavior (Task 3 and 4), lockscreen restore (Task 5), lock-screen missing field (Task 5 `_restore`).

## Known deferrals

- Window previews: `WindowPreview` is a Shell JS class tied to overview adjustments and DND. Reusing it in a dock is not a bounded change and is deferred.
- Badges: no badge API is exposed by `Shell.App` or the Shell typelibs in GNOME Shell 50.1. Badges are deferred.
- Lockscreen fade, unblank, and Esc-to-sleep are manual checks and may be deferred if they need private Shell APIs that are not stable.
- GDM/login-screen changes are out of scope.
