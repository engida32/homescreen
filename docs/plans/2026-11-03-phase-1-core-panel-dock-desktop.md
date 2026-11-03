# Homescreen Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working GNOME 50 extension with a hideable top panel, a floating Sonoma-style dock, and a clean desktop.

**Architecture:** One GJS extension with a small core and three feature modules. The core owns settings, scoped signals and timeouts, module lifecycle, and diagnostics. Each module owns one feature and its preferences page. Phase 1 ships the panel, dock, and desktop modules only.

**Tech Stack:** GJS, GNOME Shell 50.1 APIs, GSettings, GTK4 with Adwaita preferences, GPLv3.

**Spec:** `/home/emmrc-02/personal-works/ubuntu homescreen/DESIGN.md`

## Global Constraints

- Target: Ubuntu 26.04, GNOME Shell 50.1, Wayland, one personal machine.
- Extension UUID: `homescreen@engida32.github.io`.
- Settings schema: `org.gnome.shell.extensions.homescreen`.
- License: GPLv3. The GPLv3 text is already at `LICENSE`.
- Phase 1 modules: `panel`, `dock`, `desktop`. Do not add lockscreen, visual, tiling, monitor, or app-grid code.
- Defaults: panel autohide, dock floating bottom, desktop icons hidden.
- No synchronous file I/O or synchronous D-Bus on the Shell main loop.
- Every module uses `context.scope` for signals, timeouts, and actor ownership.
- `disable()` must restore the panel position and struts, destroy the dock actor, and restore DING settings.
- Never disable another extension silently. Conflict handling is detection plus a user action.
- No private API without a comment naming GNOME Shell 50.1 and the reason.
- Tests gate every task: `make test` and, after packaging exists, `make check`.
- Keep files focused. The dock module may grow, but split pure math and prefs pages into separate files.

## Review Focus

These are the failure modes most likely to hurt a real user, in order:

- Disabling the extension leaves the panel offscreen or the work area permanently shrunk.
- The dock hides but cannot be revealed, or it covers window controls.
- Magnification relayouts the dock and jitters.
- Monitor hotplug leaves panel or dock geometry on the old monitor.
- A preferences change updates the stored value but not the running module.

Each line has a test or manual acceptance step in the task that owns the code.

---

### Task 1: Project skeleton, metadata, schema, and packaging

**Files:**
- Create: `extension/metadata.json`
- Create: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`
- Create: `extension/extension.js`
- Create: `extension/prefs.js`
- Create: `extension/stylesheet.css`
- Create: `extension/src/.gitkeep`
- Create: `Makefile`
- Create: `scripts/validate-metadata.py`
- Create: `README.md`
- Test: `make pack`

**Interfaces:**
- Produces: the UUID, settings schema ID, and package layout every later task uses.
- Produces: `Makefile` targets `schemas`, `pack`, `install`, `uninstall`, `test`, `check`.

- [ ] **Step 1: Write the metadata validator**

```python
#!/usr/bin/env python3
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
META = ROOT / "extension" / "metadata.json"
SCHEMA = ROOT / "extension" / "schemas" / "org.gnome.shell.extensions.homescreen.gschema.xml"

errors = []
if not META.exists():
    errors.append("missing extension/metadata.json")
else:
    data = json.loads(META.read_text())
    if data.get("uuid") != "homescreen@engida32.github.io":
        errors.append("wrong uuid")
    if data.get("shell-version") != ["50"]:
        errors.append("shell-version must be exactly [\"50\"]")
    if data.get("settings-schema") != "org.gnome.shell.extensions.homescreen":
        errors.append("wrong settings-schema")
    if "session-modes" in data:
        errors.append("phase 1 must not request unlock-dialog")

if not SCHEMA.exists():
    errors.append("missing settings schema")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print("metadata ok")
```

- [ ] **Step 2: Run the validator and confirm it fails**

Run: `python3 scripts/validate-metadata.py`
Expected: FAIL with `missing extension/metadata.json`

- [ ] **Step 3: Create the metadata file**

`extension/metadata.json`:

```json
{
  "uuid": "homescreen@engida32.github.io",
  "name": "Homescreen",
  "description": "A personal GNOME Shell workspace with a hideable panel, a floating dock, and a clean desktop.",
  "shell-version": ["50"],
  "settings-schema": "org.gnome.shell.extensions.homescreen",
  "url": "https://github.com/engida32/homescreen"
}
```

- [ ] **Step 4: Create the GSettings schema**

`extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist gettext-domain="homescreen">
  <schema id="org.gnome.shell.extensions.homescreen"
          path="/org/gnome/shell/extensions/homescreen/">

    <key name="panel-enabled" type="b">
      <default>true</default>
      <summary>Enable the panel module</summary>
    </key>
    <key name="panel-mode" type="s">
      <default>'autohide'</default>
      <summary>Panel visibility mode</summary>
      <description>One of always, autohide, intellihide, hidden.</description>
    </key>
    <key name="panel-show-in-overview" type="b">
      <default>true</default>
      <summary>Show the panel in the overview</summary>
    </key>
    <key name="panel-show-fullscreen" type="b">
      <default>false</default>
      <summary>Reveal the panel over fullscreen windows</summary>
    </key>
    <key name="panel-hide-delay" type="i">
      <default>800</default>
      <range min="0" max="5000"/>
      <summary>Hide delay in milliseconds</summary>
    </key>
    <key name="panel-reveal-pressure" type="i">
      <default>100</default>
      <range min="0" max="500"/>
      <summary>Edge pressure needed to reveal the panel</summary>
    </key>
    <key name="panel-pressure-timeout" type="i">
      <default>1000</default>
      <range min="100" max="3000"/>
      <summary>Pressure timeout in milliseconds</summary>
    </key>
    <key name="panel-animation-time" type="d">
      <default>0.18</default>
      <range min="0.0" max="0.6"/>
      <summary>Panel animation time in seconds</summary>
    </key>
    <key name="panel-toggle-shortcut" type="as">
      <default>[]</default>
      <summary>Panel toggle shortcut</summary>
    </key>

    <key name="dock-enabled" type="b">
      <default>true</default>
      <summary>Enable the dock module</summary>
    </key>
    <key name="dock-position" type="s">
      <default>'bottom'</default>
      <summary>Dock position</summary>
      <description>Phase 1 uses bottom. left and right are reserved for the dock v2 plan.</description>
    </key>
    <key name="dock-icon-size" type="i">
      <default>52</default>
      <range min="32" max="72"/>
      <summary>Dock icon size</summary>
    </key>
    <key name="dock-spacing" type="i">
      <default>8</default>
      <range min="4" max="16"/>
      <summary>Space between dock icons</summary>
    </key>
    <key name="dock-padding" type="i">
      <default>10</default>
      <range min="4" max="20"/>
      <summary>Dock inner padding</summary>
    </key>
    <key name="dock-margin" type="i">
      <default>10</default>
      <range min="4" max="24"/>
      <summary>Dock margin from the screen edge</summary>
    </key>
    <key name="dock-radius" type="i">
      <default>24</default>
      <range min="16" max="32"/>
      <summary>Dock corner radius</summary>
    </key>
    <key name="dock-opacity" type="d">
      <default>0.72</default>
      <range min="0.3" max="1.0"/>
      <summary>Dock background opacity</summary>
    </key>
    <key name="dock-autohide" type="b">
      <default>true</default>
      <summary>Hide the dock when not in use</summary>
    </key>
    <key name="dock-intellihide" type="b">
      <default>true</default>
      <summary>Hide the dock when a window overlaps it</summary>
    </key>
    <key name="dock-magnification" type="b">
      <default>true</default>
      <summary>Magnify dock icons near the pointer</summary>
    </key>
    <key name="dock-magnification-strength" type="d">
      <default>0.35</default>
      <range min="0.0" max="0.45"/>
      <summary>Dock magnification strength</summary>
    </key>
    <key name="dock-hide-delay" type="i">
      <default>300</default>
      <range min="0" max="2000"/>
      <summary>Dock hide delay in milliseconds</summary>
    </key>

    <key name="desktop-enabled" type="b">
      <default>true</default>
      <summary>Enable the desktop module</summary>
    </key>
    <key name="desktop-hide-icons" type="b">
      <default>true</default>
      <summary>Hide desktop icons</summary>
    </key>
    <key name="desktop-focus-mode" type="b">
      <default>false</default>
      <summary>Hide the panel and dock for focus</summary>
    </key>
    <key name="desktop-show-desktop-shortcut" type="as">
      <default>[]</default>
      <summary>Show desktop shortcut</summary>
    </key>

    <key name="diagnostics-json" type="s">
      <default>'{}'</default>
      <summary>Last module status snapshot</summary>
    </key>
  </schema>
</schemalist>
```

- [ ] **Step 5: Create the Makefile**

```make
SHELL_UUID := homescreen@engida32.github.io
PACK := dist/$(SHELL_UUID).shell-extension.zip

.PHONY: schemas pack install uninstall test check clean

schemas:
	glib-compile-schemas extension/schemas

pack: schemas
	mkdir -p dist
	gnome-extensions pack --force \
		--extra-source=src \
		--schema=schemas/org.gnome.shell.extensions.homescreen.gschema.xml \
		--out-dir=dist extension

install: pack
	gnome-extensions install --force $(PACK)
	gnome-extensions enable $(SHELL_UUID)

uninstall:
	-gnome-extensions disable $(SHELL_UUID)
	gnome-extensions uninstall $(SHELL_UUID)

test: schemas
	python3 scripts/validate-metadata.py
	gjs -m tests/resources.test.js
	gjs -m tests/registry.test.js
	gjs -m tests/panel-geometry.test.js
	gjs -m tests/dock-layout.test.js
	gjs -m tests/dock-magnification.test.js
	gjs -m tests/desktop.test.js
	gjs -m tests/stylesheet.test.js
	for file in extension/extension.js extension/prefs.js extension/src/**/*.js; do \
		node --input-type=module --check < "$$file"; \
	done

check: pack test
	bash tests/headless-install-probe.sh

clean:
	rm -rf dist extension/schemas/gschemas.compiled
```

- [ ] **Step 6: Create the minimal entry files**

`extension/extension.js`:

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class HomescreenExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
    }

    disable() {
        this._settings = null;
    }
}
```

`extension/prefs.js`:

```js
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class HomescreenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(720, 560);
        window.set_title(_('Homescreen'));
    }
}
```

`extension/stylesheet.css`:

```css
/* Homescreen styles are added in Task 13. */
```

Create `extension/src/.gitkeep` as an empty file.

- [ ] **Step 7: Create the README**

`README.md`:

```markdown
# Homescreen

A personal GNOME 50 extension with a hideable top panel, a floating dock, and a clean desktop.

## Build

```bash
make test
make pack
```

The package is written to `dist/homescreen@engida32.github.io.shell-extension.zip`.

## Install

```bash
make install
```

Log out and back in on Wayland after a code change.

## Remove

```bash
make uninstall
```
```

- [ ] **Step 8: Run the validator and pack**

Run: `python3 scripts/validate-metadata.py`
Expected: PASS with `metadata ok`

Run: `make pack`
Expected: PASS, and `dist/homescreen@engida32.github.io.shell-extension.zip` exists.

- [ ] **Step 9: Commit**

```bash
git init
git add extension/metadata.json extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml extension/extension.js extension/prefs.js extension/stylesheet.css extension/src/.gitkeep Makefile scripts/validate-metadata.py README.md LICENSE
git commit -m "chore: scaffold Homescreen extension"
```

---

### Task 2: Scoped signal and timeout ownership

**Files:**
- Create: `extension/src/core/resources.js`
- Create: `tests/helpers.js`
- Test: `tests/resources.test.js`

**Interfaces:**
- Produces: `SignalRegistry.connect(target, signal, callback): number`
- Produces: `SignalRegistry.disconnect(id): void`
- Produces: `SignalRegistry.disconnectAll(): void`
- Produces: `SourceRegistry.timeoutAdd(priority, interval, callback): number`
- Produces: `SourceRegistry.idleAdd(priority, callback): number`
- Produces: `SourceRegistry.remove(id): void`
- Produces: `SourceRegistry.removeAll(): void`
- Produces: `ModuleScope.signal(target, signal, callback): number`
- Produces: `ModuleScope.timeout(interval, callback, priority = GLib.PRIORITY_DEFAULT): number`
- Produces: `ModuleScope.idle(callback, priority = GLib.PRIORITY_DEFAULT): number`
- Produces: `ModuleScope.destroy(): void`
- Produces: `ModuleScope.signalCount` and `ModuleScope.sourceCount`

- [ ] **Step 1: Write the failing tests**

`tests/helpers.js`:

```js
import GLib from 'gi://GLib';

export function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new Error(message);
}

export function assertEqual(actual, expected, message = '') {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

export function waitFor(promise) {
    const loop = GLib.MainLoop.new(null, false);
    let value;
    let error;
    promise.then(result => {
        value = result;
        loop.quit();
    }, failure => {
        error = failure;
        loop.quit();
    });
    loop.run();
    if (error)
        throw error;
    return value;
}

export function waitForTimeout(milliseconds) {
    return waitFor(new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    }));
}
```

`tests/resources.test.js`:

```js
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {ModuleScope, SignalRegistry, SourceRegistry} from '../extension/src/core/resources.js';
import {assertEqual, waitForTimeout} from './helpers.js';

const Emitter = GObject.registerClass({
    Signals: {'ping': {}},
}, class Emitter extends GObject.Object {});

const emitter = new Emitter();
let count = 0;

const signals = new SignalRegistry();
const id = signals.connect(emitter, 'ping', () => count++);
emitter.emit('ping');
assertEqual(count, 1, 'signal fires');
signals.disconnect(id);
emitter.emit('ping');
assertEqual(count, 1, 'disconnect removes the handler');

const sourceA = new SourceRegistry();
let fired = 0;
sourceA.timeoutAdd(GLib.PRIORITY_DEFAULT, 10, () => {
    fired++;
    return GLib.SOURCE_REMOVE;
});
waitForTimeout(40);
assertEqual(fired, 1, 'timeout fires');
assertEqual(sourceA.size, 0, 'completed source is forgotten');

const sourceB = new SourceRegistry();
const busyId = sourceB.timeoutAdd(GLib.PRIORITY_DEFAULT, 50, () => GLib.SOURCE_CONTINUE);
sourceB.remove(busyId);
assertEqual(sourceB.size, 0, 'removed source is forgotten');

const scope = new ModuleScope('test');
scope.signal(emitter, 'ping', () => count++);
scope.timeout(10, () => GLib.SOURCE_REMOVE);
assertEqual(scope.signalCount, 1, 'scope counts signals');
assertEqual(scope.sourceCount, 1, 'scope counts sources');
scope.destroy();
assertEqual(scope.signalCount, 0, 'scope clears signals');
assertEqual(scope.sourceCount, 0, 'scope clears sources');
emitter.emit('ping');
assertEqual(count, 1, 'scope destroy disconnects');

print('resource tests passed');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `gjs -m tests/resources.test.js`
Expected: FAIL with a module-not-found error for `resources.js`

- [ ] **Step 3: Implement the registries**

`extension/src/core/resources.js`:

```js
import GLib from 'gi://GLib';

export class SignalRegistry {
    constructor() {
        this._entries = new Map();
        this._nextId = 1;
    }

    connect(target, signal, callback) {
        const targetId = target.connect(signal, callback);
        const id = this._nextId++;
        this._entries.set(id, {target, targetId});
        return id;
    }

    disconnect(id) {
        const entry = this._entries.get(id);
        if (!entry)
            return;
        this._entries.delete(id);
        try {
            entry.target.disconnect(entry.targetId);
        } catch {
            // The actor may already be destroyed.
        }
    }

    disconnectAll() {
        for (const {target, targetId} of this._entries.values()) {
            try {
                target.disconnect(targetId);
            } catch {
                // The actor may already be destroyed.
            }
        }
        this._entries.clear();
    }

    get size() {
        return this._entries.size;
    }
}

export class SourceRegistry {
    constructor() {
        this._ids = new Set();
    }

    timeoutAdd(priority, interval, callback) {
        let id = 0;
        id = GLib.timeout_add(priority, interval, () => {
            const result = callback();
            if (result === GLib.SOURCE_REMOVE)
                this._ids.delete(id);
            return result;
        });
        this._ids.add(id);
        return id;
    }

    idleAdd(priority, callback) {
        let id = 0;
        id = GLib.idle_add(priority, () => {
            const result = callback();
            if (result === GLib.SOURCE_REMOVE)
                this._ids.delete(id);
            return result;
        });
        this._ids.add(id);
        return id;
    }

    remove(id) {
        if (!this._ids.delete(id))
            return;
        try {
            GLib.source_remove(id);
        } catch {
            // The source already completed.
        }
    }

    removeAll() {
        for (const id of this._ids) {
            try {
                GLib.source_remove(id);
            } catch {
                // The source already completed.
            }
        }
        this._ids.clear();
    }

    get size() {
        return this._ids.size;
    }
}

export class ModuleScope {
    constructor(name) {
        this.name = name;
        this._signals = new SignalRegistry();
        this._sources = new SourceRegistry();
    }

    signal(target, signal, callback) {
        return this._signals.connect(target, signal, callback);
    }

    timeout(interval, callback, priority = GLib.PRIORITY_DEFAULT) {
        return this._sources.timeoutAdd(priority, interval, callback);
    }

    idle(callback, priority = GLib.PRIORITY_DEFAULT) {
        return this._sources.idleAdd(priority, callback);
    }

    destroy() {
        this._signals.disconnectAll();
        this._sources.removeAll();
    }

    get signalCount() {
        return this._signals.size;
    }

    get sourceCount() {
        return this._sources.size;
    }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `gjs -m tests/resources.test.js`
Expected: PASS with `resource tests passed`

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/resources.js tests/helpers.js tests/resources.test.js
git commit -m "feat: add scoped signal and timeout ownership"
```

---

### Task 3: Core context, module registry, logger, and diagnostics

**Files:**
- Create: `extension/src/core/logger.js`
- Create: `extension/src/core/diagnostics.js`
- Create: `extension/src/core/context.js`
- Create: `extension/src/core/registry.js`
- Test: `tests/registry.test.js`

**Interfaces:**
- Produces: `Logger.info(message)`, `Logger.error(message, error)`, `Logger.entries(): Array<{time, level, message}>`
- Produces: `Diagnostics.setModule(id, status, detail = '')`, `Diagnostics.snapshot(): object`
- Produces: `Context(extension, settings)`, with `context.scope(name)`, `context.getModule(id)`
- Produces: `ModuleRegistry(context)`, with `add(id, module, enabledKey)`, `enableAll()`, `disableAll()`, `status(id)`
- Module contract: `module.enable(moduleContext)` and `module.disable()`
- `moduleContext` contains `extension`, `settings`, `logger`, `diagnostics`, `scope`, `getModule(id)`

- [ ] **Step 1: Write the failing registry test**

`tests/registry.test.js`:

```js
import Gio from 'gi://Gio';

import {Context} from '../extension/src/core/context.js';
import {ModuleRegistry} from '../extension/src/core/registry.js';
import {assert, assertEqual} from './helpers.js';

const log = [];
const extension = {uuid: 'test'};
const schemaSource = Gio.SettingsSchemaSource.get_default();
const schema = schemaSource.lookup('org.gnome.shell.extensions.homescreen', true);
if (!schema)
    throw new Error('schema not compiled; run make schemas first');
const settings = new Gio.Settings({settings_schema: schema});
settings.set_boolean('panel-enabled', true);
settings.set_boolean('dock-enabled', true);

const context = new Context(extension, settings);
const registry = new ModuleRegistry(context);

const first = {
    enable(moduleContext) {
        log.push('first-enable');
        this.scope = moduleContext.scope;
        this.scope.signal(settings, 'changed::panel-mode', () => log.push('panel-mode'));
    },
    disable() {
        log.push('first-disable');
    },
};

const second = {
    enable() {
        log.push('second-enable');
        throw new Error('boom');
    },
    disable() {
        log.push('second-disable');
    },
};

registry.add('first', first, 'panel-enabled');
registry.add('second', second, 'dock-enabled');
registry.enableAll();

assertEqual(log.join(','), 'first-enable,second-enable', 'enable order and failure isolation');
assertEqual(registry.status('first'), 'enabled', 'first is enabled');
assertEqual(registry.status('second'), 'failed', 'second is failed');
assert(context.snapshot().modules.second.detail.includes('boom'), 'failure is recorded');

registry.disableAll();
assertEqual(log[log.length - 1], 'first-disable', 'enabled modules disable in reverse order');
assertEqual(registry.status('first'), 'disabled', 'first is disabled after shutdown');
assertEqual(context.scopeCount, 0, 'all scopes are destroyed');

print('registry tests passed');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `make schemas && gjs -m tests/registry.test.js`
Expected: FAIL with a module-not-found error for `context.js`

- [ ] **Step 3: Implement the logger and diagnostics**

`extension/src/core/logger.js`:

```js
export class Logger {
    constructor(limit = 100) {
        this._limit = limit;
        this._entries = [];
    }

    info(message) {
        this._push('info', message);
    }

    error(message, error) {
        const detail = error?.message ?? String(error);
        this._push('error', `${message}: ${detail}`);
        if (error?.stack)
            console.error(error.stack);
    }

    _push(level, message) {
        this._entries.push({time: Date.now(), level, message});
        if (this._entries.length > this._limit)
            this._entries.shift();
    }

    entries() {
        return [...this._entries];
    }
}
```

`extension/src/core/diagnostics.js`:

```js
export class Diagnostics {
    constructor(settings, logger) {
        this._settings = settings;
        this._logger = logger;
        this._modules = new Map();
    }

    setModule(id, status, detail = '') {
        this._modules.set(id, {status, detail});
        this._write();
    }

    snapshot() {
        return {
            modules: Object.fromEntries(this._modules),
            log: this._logger.entries().slice(-20),
        };
    }

    _write() {
        this._settings.set_string('diagnostics-json', JSON.stringify(this.snapshot()));
    }
}
```

- [ ] **Step 4: Implement the context and registry**

`extension/src/core/context.js`:

```js
import {Diagnostics} from './diagnostics.js';
import {Logger} from './logger.js';
import {ModuleScope} from './resources.js';

export class Context {
    constructor(extension, settings) {
        this.extension = extension;
        this.settings = settings;
        this.logger = new Logger();
        this.diagnostics = new Diagnostics(settings, this.logger);
        this._modules = new Map();
        this._scopes = new Set();
    }

    scope(name) {
        const scope = new ModuleScope(name);
        this._scopes.add(scope);
        return scope;
    }

    releaseScope(scope) {
        scope.destroy();
        this._scopes.delete(scope);
    }

    registerModule(id, module) {
        this._modules.set(id, module);
    }

    getModule(id) {
        return this._modules.get(id) ?? null;
    }

    snapshot() {
        return this.diagnostics.snapshot();
    }

    destroy() {
        for (const scope of this._scopes)
            scope.destroy();
        this._scopes.clear();
        this._modules.clear();
    }

    get scopeCount() {
        return this._scopes.size;
    }
}
```

`extension/src/core/registry.js`:

```js
export class ModuleRegistry {
    constructor(context) {
        this._context = context;
        this._entries = [];
        this._enabled = [];
    }

    add(id, module, enabledKey = null) {
        this._entries.push({id, module, enabledKey});
        this._context.registerModule(id, module);
    }

    enableAll() {
        for (const entry of this._entries) {
            if (entry.enabledKey &&
                !this._context.settings.get_boolean(entry.enabledKey)) {
                this._context.diagnostics.setModule(entry.id, 'disabled', 'settings');
                continue;
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
    }

    disableAll() {
        for (const {entry, scope} of this._enabled.reverse()) {
            try {
                entry.module.disable();
            } catch (error) {
                this._context.logger.error(`${entry.id} failed to disable`, error);
            } finally {
                this._context.releaseScope(scope);
                this._context.diagnostics.setModule(entry.id, 'disabled');
            }
        }
        this._enabled = [];
    }

    status(id) {
        return this._context.snapshot().modules[id]?.status ?? 'unknown';
    }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `make schemas && gjs -m tests/registry.test.js`
Expected: PASS with `registry tests passed`

- [ ] **Step 6: Commit**

```bash
git add extension/src/core/logger.js extension/src/core/diagnostics.js extension/src/core/context.js extension/src/core/registry.js tests/registry.test.js
git commit -m "feat: add core context and module registry"
```

---

### Task 4: Extension entry point with module switches

**Files:**
- Modify: `extension/extension.js`
- Test: `make pack`

**Interfaces:**
- Consumes: `Context`, `ModuleRegistry`
- Consumes: `PanelModule`, `DockModule`, `DesktopModule` from later tasks
- Produces: the enable and disable lifecycle used by every later task

- [ ] **Step 1: Write the failing pack check**

Run: `make pack`
Expected: PASS for the placeholder entry point, but `node --check` in `make test` will fail after the next step until imports exist. This step exists to establish the packaging gate.

- [ ] **Step 2: Replace the entry point**

`extension/extension.js`:

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Context} from './src/core/context.js';
import {ModuleRegistry} from './src/core/registry.js';
import {PanelModule} from './src/modules/panel/panelModule.js';
import {DockModule} from './src/modules/dock/dockModule.js';
import {DesktopModule} from './src/modules/desktop/desktopModule.js';

export default class HomescreenExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._context = new Context(this, this._settings);
        this._registry = new ModuleRegistry(this._context);

        this._registry.add('panel', new PanelModule(), 'panel-enabled');
        this._registry.add('dock', new DockModule(), 'dock-enabled');
        this._registry.add('desktop', new DesktopModule(), 'desktop-enabled');

        this._registry.enableAll();
    }

    disable() {
        this._registry?.disableAll();
        this._context?.destroy();
        this._registry = null;
        this._context = null;
        this._settings = null;
    }
}
```

- [ ] **Step 3: Create temporary module stubs so the imports resolve**

`extension/src/modules/panel/panelModule.js`:

```js
export class PanelModule {
    enable() {}
    disable() {}
    setForcedHidden() {}
}
```

`extension/src/modules/dock/dockModule.js`:

```js
export class DockModule {
    enable() {}
    disable() {}
    setForcedHidden() {}
}
```

`extension/src/modules/desktop/desktopModule.js`:

```js
export class DesktopModule {
    enable() {}
    disable() {}
}
```

- [ ] **Step 4: Run syntax and pack checks**

Run: `make test`
Expected: PASS with the placeholder module stubs.

Run: `make pack`
Expected: PASS and a zip in `dist/`.

- [ ] **Step 5: Commit**

```bash
git add extension/extension.js extension/src/modules/panel/panelModule.js extension/src/modules/dock/dockModule.js extension/src/modules/desktop/desktopModule.js
git commit -m "feat: add extension lifecycle"
```

---

### Task 5: Panel geometry and visibility math

**Files:**
- Create: `extension/src/modules/panel/geometry.js`
- Test: `tests/panel-geometry.test.js`

**Interfaces:**
- Produces: `rectsOverlap(a, b): boolean` where each rect is `{x, y, width, height}`
- Produces: `targetY(baseY, height, hidden): number`
- Produces: `modeHides(mode): boolean`
- Produces: `shouldHidePanel({mode, forcedHidden, overviewVisible, showInOverview, overlaps}): boolean`

- [ ] **Step 1: Write the failing tests**

`tests/panel-geometry.test.js`:

```js
import {
    modeHides,
    rectsOverlap,
    shouldHidePanel,
    targetY,
} from '../extension/src/modules/panel/geometry.js';
import {assert, assertEqual} from './helpers.js';

assert(rectsOverlap(
    {x: 0, y: 0, width: 100, height: 10},
    {x: 50, y: -5, width: 20, height: 20}
), 'overlapping rects');
assert(!rectsOverlap(
    {x: 0, y: 0, width: 100, height: 10},
    {x: 0, y: 11, width: 100, height: 10}
), 'touching edges do not overlap');

assertEqual(targetY(0, 36, true), -36, 'hidden panel moves above the monitor');
assertEqual(targetY(0, 36, false), 0, 'visible panel returns to base');

assert(modeHides('autohide'), 'autohide hides');
assert(modeHides('intellihide'), 'intellihide hides');
assert(modeHides('hidden'), 'hidden hides');
assert(!modeHides('always'), 'always does not hide');

assert(shouldHidePanel({
    mode: 'always',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: true,
}), 'always mode is shown before the panel decision, so this function returns false only when the caller skips it');
```

Replace the last assertion with the intended behavior:

```js
assert(!shouldHidePanel({
    mode: 'always',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: true,
}), 'always mode stays visible');
assert(shouldHidePanel({
    mode: 'autohide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: false,
}), 'autohide hides outside the overview');
assert(!shouldHidePanel({
    mode: 'autohide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: false,
    pointerInPanel: true,
}), 'autohide stays visible while the pointer is in the panel');
assert(!shouldHidePanel({
    mode: 'intellihide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: true,
}), 'intellihide stays visible when a window overlaps');
assert(shouldHidePanel({
    mode: 'intellihide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: false,
}), 'intellihide hides without overlap');
assert(!shouldHidePanel({
    mode: 'autohide',
    forcedHidden: false,
    overviewVisible: true,
    showInOverview: true,
    overlaps: false,
}), 'show in overview keeps the panel visible');
assert(shouldHidePanel({
    mode: 'hidden',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: true,
}), 'hidden mode hides');

print('panel geometry tests passed');
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `gjs -m tests/panel-geometry.test.js`
Expected: FAIL with a module-not-found error

- [ ] **Step 3: Implement the geometry functions**

`extension/src/modules/panel/geometry.js`:

```js
export function rectsOverlap(a, b) {
    return a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
}

export function targetY(baseY, height, hidden) {
    return hidden ? baseY - height : baseY;
}

export function modeHides(mode) {
    return mode !== 'always';
}

export function shouldHidePanel({
    mode,
    forcedHidden,
    overviewVisible,
    showInOverview,
    overlaps,
    pointerInPanel = false,
}) {
    if (forcedHidden || mode === 'hidden')
        return true;
    if (mode === 'always')
        return false;
    if (overviewVisible)
        return !showInOverview;
    if (pointerInPanel)
        return false;
    if (mode === 'intellihide')
        return !overlaps;
    return true;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `gjs -m tests/panel-geometry.test.js`
Expected: PASS with `panel geometry tests passed`

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/panel/geometry.js tests/panel-geometry.test.js
git commit -m "feat: add panel visibility math"
```

---

### Task 6: Panel module

**Files:**
- Modify: `extension/src/modules/panel/panelModule.js`
- Test: `make pack`, manual panel checks

**Interfaces:**
- Consumes: `shouldHidePanel`, `targetY`, `rectsOverlap`
- Produces: `PanelModule.enable(context)`
- Produces: `PanelModule.disable()`
- Produces: `PanelModule.setForcedHidden(hidden: boolean)`

- [ ] **Step 1: Replace the panel stub**

`extension/src/modules/panel/panelModule.js`:

```js
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
```

- [ ] **Step 2: Run syntax and pack checks**

Run: `make test`
Expected: PASS for panel geometry; the panel module syntax check passes.

Run: `make pack`
Expected: PASS.

- [ ] **Step 3: Manual panel check**

Install and enable the extension, then log out and back in on Wayland.

Check:

1. Panel hides after the configured delay.
2. Move the pointer to the top edge and hold for the pressure timeout. Panel reveals.
3. Open the overview. Panel appears if `panel-show-in-overview` is on.
4. Move a normal window to the top edge. With `intellihide`, the panel appears.
5. Disable the extension. Panel returns to the top and the work area is normal.

- [ ] **Step 4: Commit**

```bash
git add extension/src/modules/panel/panelModule.js
git commit -m "feat: add hideable top panel"
```

---

### Task 7: Panel preferences page

**Files:**
- Create: `extension/src/prefs/helpers.js`
- Create: `extension/src/prefs/panelPage.js`
- Modify: `extension/prefs.js`
- Test: `make pack`

**Interfaces:**
- Produces: `switchRow(settings, key, title, subtitle): Adw.SwitchRow`
- Produces: `spinRow(settings, key, title, subtitle, lower, upper, step): Adw.SpinRow`
- Produces: `comboRow(settings, key, title, values): Adw.ComboRow`
- Produces: `shortcutRow(settings, key, title): Adw.ActionRow`
- Produces: `buildPanelPage(window, settings): Adw.PreferencesPage`

- [ ] **Step 1: Write the preferences helpers**

`extension/src/prefs/helpers.js`:

```js
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function spinRow(settings, key, title, subtitle, lower, upper, step) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 5,
            value: settings.get_int(key),
        }),
    });
    row.connect('notify::value', () => {
        settings.set_int(key, Math.round(row.value));
    });
    settings.connect(`changed::${key}`, () => {
        const value = settings.get_int(key);
        if (Math.round(row.value) !== value)
            row.value = value;
    });
    return row;
}

export function comboRow(settings, key, title, values) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(values),
    });
    const sync = () => {
        const value = settings.get_string(key);
        const index = values.indexOf(value);
        row.selected = index >= 0 ? index : 0;
    };
    row.connect('notify::selected', () => {
        const value = values[row.selected] ?? values[0];
        if (settings.get_string(key) !== value)
            settings.set_string(key, value);
    });
    settings.connect(`changed::${key}`, sync);
    sync();
    return row;
}

export function shortcutRow(settings, key, title) {
    const row = new Adw.ActionRow({title});
    const label = new Gtk.ShortcutLabel({
        accelerator: settings.get_strv(key)[0] ?? '',
        disabled_text: 'Disabled',
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(label);
    settings.connect(`changed::${key}`, () => {
        label.set_accelerator(settings.get_strv(key)[0] ?? '');
    });
    return row;
}
```

- [ ] **Step 2: Write the panel page**

`extension/src/prefs/panelPage.js`:

```js
import Adw from 'gi://Adw';

import {comboRow, shortcutRow, spinRow} from './helpers.js';

export function buildPanelPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Panel',
        icon_name: 'focus-top-bar-symbolic',
    });
    window.add(page);

    const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
    page.add(behavior);
    behavior.add(comboRow(settings, 'panel-mode', 'Visibility', [
        'always',
        'autohide',
        'intellihide',
        'hidden',
    ]));
    behavior.add(shortcutRow(settings, 'panel-toggle-shortcut', 'Toggle shortcut'));

    const timing = new Adw.PreferencesGroup({title: 'Timing'});
    page.add(timing);
    timing.add(spinRow(settings, 'panel-hide-delay', 'Hide delay',
        'Milliseconds after the pointer leaves the panel.', 0, 5000, 100));
    timing.add(spinRow(settings, 'panel-reveal-pressure', 'Reveal pressure',
        'Pressure needed at the top edge. Lower is easier.', 0, 500, 10));
    timing.add(spinRow(settings, 'panel-pressure-timeout', 'Pressure timeout',
        'Milliseconds the pointer must rest at the edge.', 100, 3000, 100));

    const overview = new Adw.PreferencesGroup({title: 'Overview'});
    page.add(overview);
    overview.add(switchRow(settings, 'panel-show-in-overview',
        'Show in overview', 'Keep the panel visible while the overview is open.'));
    overview.add(switchRow(settings, 'panel-show-fullscreen',
        'Show over fullscreen', 'Allow the panel to reveal over fullscreen windows.'));

    return page;
}
```

Add the missing import in the same file:

```js
import {comboRow, shortcutRow, spinRow, switchRow} from './helpers.js';
```

- [ ] **Step 3: Wire the page into preferences**

`extension/prefs.js`:

```js
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildPanelPage} from './src/prefs/panelPage.js';

export default class HomescreenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(760, 620);
        window.set_title(_('Homescreen'));
        const settings = this.getSettings();
        buildPanelPage(window, settings);
    }
}
```

- [ ] **Step 4: Run syntax and pack checks**

Run: `make test`
Expected: PASS with all current tests and syntax checks.

Run: `make pack`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/prefs/helpers.js extension/src/prefs/panelPage.js extension/prefs.js
git commit -m "feat: add panel preferences"
```

---

### Task 8: Dock layout and magnification math

**Files:**
- Create: `extension/src/modules/dock/layout.js`
- Create: `extension/src/modules/dock/magnification.js`
- Test: `tests/dock-layout.test.js`
- Test: `tests/dock-magnification.test.js`

**Interfaces:**
- Produces: `dockWidth(count, iconSize, spacing, padding): number`
- Produces: `dockHeight(iconSize, padding, indicatorSpace = 10): number`
- Produces: `slotCenter(index, iconSize, spacing, padding): number`
- Produces: `dockOrigin(monitor, width, height, margin): {x, y}`
- Produces: `hiddenDockY(monitor, margin): number`
- Produces: `scaleForDistance(distance, slot, strength, falloff): number`
- Produces: `scalesForCenters(pointerX, centers, slot, strength, falloff): number[]`

- [ ] **Step 1: Write the failing layout tests**

`tests/dock-layout.test.js`:

```js
import {
    dockHeight,
    dockOrigin,
    dockWidth,
    hiddenDockY,
    slotCenter,
} from '../extension/src/modules/dock/layout.js';
import {assertEqual} from './helpers.js';

assertEqual(dockWidth(1, 52, 8, 10), 72, 'one icon plus padding');
assertEqual(dockWidth(3, 52, 8, 10), 188, 'three icons plus spacing and padding');
assertEqual(dockHeight(52, 10), 72, 'dock height includes indicator space');
assertEqual(slotCenter(0, 52, 8, 10), 36, 'first slot center');
assertEqual(slotCenter(1, 52, 8, 10), 96, 'second slot center');

const monitor = {x: 0, y: 0, width: 1000, height: 800};
assertEqual(dockOrigin(monitor, 200, 72, 10).x, 400, 'dock is centered');
assertEqual(dockOrigin(monitor, 200, 72, 10).y, 718, 'dock sits above the bottom edge');
assertEqual(hiddenDockY(monitor, 10), 798, 'hidden dock leaves a two pixel reveal strip');

print('dock layout tests passed');
```

- [ ] **Step 2: Write the failing magnification tests**

`tests/dock-magnification.test.js`:

```js
import {
    scaleForDistance,
    scalesForCenters,
} from '../extension/src/modules/dock/magnification.js';
import {assert, assertEqual} from './helpers.js';

assertEqual(scaleForDistance(0, 60, 0.35, 1.4), 1.35, 'pointer at icon center');
assert(scaleForDistance(60, 60, 0.35, 1.4) < 1.35, 'neighbor scales less');
assert(scaleForDistance(600, 60, 0.35, 1.4) < 1.01, 'far icon ignores magnification');
assert(scaleForDistance(0, 60, 0.9, 1.4) <= 1.45, 'scale is clamped');

const scales = scalesForCenters(96, [36, 96, 156], 60, 0.35, 1.4);
assertEqual(scales.length, 3, 'one scale per icon');
assertEqual(scales[1], 1.35, 'hovered icon is largest');
assert(scales[0] < scales[1] && scales[2] < scales[1], 'neighbors are smaller');

print('dock magnification tests passed');
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `gjs -m tests/dock-layout.test.js && gjs -m tests/dock-magnification.test.js`
Expected: FAIL with module-not-found errors

- [ ] **Step 4: Implement the layout math**

`extension/src/modules/dock/layout.js`:

```js
export function dockWidth(count, iconSize, spacing, padding) {
    if (count <= 0)
        return padding * 2;
    return count * iconSize + (count - 1) * spacing + padding * 2;
}

export function dockHeight(iconSize, padding, indicatorSpace = 10) {
    return iconSize + padding * 2 + indicatorSpace;
}

export function slotCenter(index, iconSize, spacing, padding) {
    return padding + index * (iconSize + spacing) + iconSize / 2;
}

export function dockOrigin(monitor, width, height, margin) {
    return {
        x: monitor.x + Math.round((monitor.width - width) / 2),
        y: monitor.y + monitor.height - height - margin,
    };
}

export function hiddenDockY(monitor, margin) {
    return monitor.y + monitor.height - 2 + margin;
}
```

- [ ] **Step 5: Implement the magnification math**

`extension/src/modules/dock/magnification.js`:

```js
export function scaleForDistance(distance, slot, strength = 0.35, falloff = 1.4) {
    if (slot <= 0)
        return 1;
    const normalized = distance / slot;
    const scale = 1 + strength * Math.exp(-Math.pow(normalized / falloff, 2));
    return Math.min(1.45, Math.max(1, scale));
}

export function scalesForCenters(pointerX, centers, slot, strength = 0.35, falloff = 1.4) {
    return centers.map(center =>
        scaleForDistance(Math.abs(pointerX - center), slot, strength, falloff)
    );
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `gjs -m tests/dock-layout.test.js && gjs -m tests/dock-magnification.test.js`
Expected: PASS with both test messages

- [ ] **Step 7: Commit**

```bash
git add extension/src/modules/dock/layout.js extension/src/modules/dock/magnification.js tests/dock-layout.test.js tests/dock-magnification.test.js
git commit -m "feat: add dock layout and magnification math"
```

---

### Task 9: Dock actor, pinned apps, running apps, and click behavior

**Files:**
- Create: `extension/src/modules/dock/dockIcon.js`
- Modify: `extension/src/modules/dock/dockModule.js`
- Test: `make pack`, manual dock checks

**Interfaces:**
- Consumes: `dockOrigin`, `dockWidth`, `dockHeight`
- Produces: `HomescreenDockIcon extends Dash.DashIcon`
- Produces: `DockModule.enable(context)`, `disable()`, `setForcedHidden(hidden)`

- [ ] **Step 1: Write the dock icon class**

`extension/src/modules/dock/dockIcon.js`:

```js
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class HomescreenDockIcon extends Dash.DashIcon {
    _init(app) {
        super._init(app);
        this.add_style_class_name('homescreen-dock-icon');
        this.app.connectObject(
            'windows-changed',
            () => this._syncRunning(),
            this
        );
        this.app.connectObject(
            'notify::state',
            () => this._syncRunning(),
            this
        );
        this._syncRunning();
    }

    _syncRunning() {
        const running = this.app.state === Shell.AppState.RUNNING &&
            this.app.get_windows().length > 0;
        if (running)
            this.add_style_class_name('homescreen-running');
        else
            this.remove_style_class_name('homescreen-running');
    }

    activate(button) {
        const app = this.app;

        if (button === Clutter.BUTTON_MIDDLE) {
            if (app.can_open_new_window())
                app.open_new_window(-1);
            else
                app.activate();
            return;
        }

        const windows = app.get_windows();
        if (windows.length === 0) {
            this.animateLaunch();
            app.activate();
            return;
        }

        const focused = global.display.focus_window;
        if (focused && windows.includes(focused)) {
            for (const window of windows)
                window.minimize();
            return;
        }

        Main.activateWindow(windows[0]);
    }
}
```

- [ ] **Step 2: Replace the dock stub with the actor and list**

`extension/src/modules/dock/dockModule.js`:

```js
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HomescreenDockIcon} from './dockIcon.js';
import {dockHeight, dockOrigin, dockWidth} from './layout.js';

export class DockModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._container = null;
        this._background = null;
        this._box = null;
        this._icons = [];
        this._rebuildSource = 0;
        this._forcedHidden = false;
        this._shownY = 0;
        this._hiddenY = 0;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;

        this._container = new St.Widget({
            name: 'homescreen-dock',
            style_class: 'homescreen-dock',
            reactive: true,
            track_hover: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._background = new St.Widget({
            style_class: 'homescreen-dock-background',
            x_expand: true,
            y_expand: true,
        });
        this._box = new St.BoxLayout({
            style_class: 'homescreen-dock-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });

        this._container.add_child(this._background);
        this._container.add_child(this._box);
        Main.layoutManager.addChrome(this._container, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        const appSystem = Shell.AppSystem.get_default();
        const favorites = AppFavorites.getAppFavorites();
        this._scope.signal(appSystem, 'installed-changed', () => this._queueRebuild());
        this._scope.signal(appSystem, 'app-state-changed', () => this._queueRebuild());
        this._scope.signal(favorites, 'changed', () => this._queueRebuild());
        this._scope.signal(this._settings, 'changed::dock-icon-size', () => this._rebuild());
        this._scope.signal(this._settings, 'changed::dock-spacing', () => this._rebuild());
        this._scope.signal(this._settings, 'changed::dock-padding', () => this._rebuild());
        this._scope.signal(this._settings, 'changed::dock-margin', () => this._position());

        this._rebuild();
    }

    setForcedHidden(hidden) {
        this._forcedHidden = hidden;
        this._container.visible = !hidden;
    }

    _queueRebuild() {
        if (this._rebuildSource)
            return;
        this._rebuildSource = this._scope.timeout(50, () => {
            this._rebuildSource = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        for (const icon of this._icons)
            icon.destroy();
        this._icons = [];

        const appSystem = Shell.AppSystem.get_default();
        const favorites = AppFavorites.getAppFavorites();
        const pinnedIds = favorites.getFavorites();
        const pinned = pinnedIds
            .map(id => appSystem.lookup_app(id))
            .filter(app => app !== null);
        const pinnedSet = new Set(pinned.map(app => app.get_id()));
        const running = appSystem.get_running()
            .filter(app => !pinnedSet.has(app.get_id()));

        for (const app of [...pinned, ...running])
            this._icons.push(this._makeIcon(app));

        this._position();
    }

    _makeIcon(app) {
        const icon = new HomescreenDockIcon(app);
        icon.icon.setIconSize(this._settings.get_int('dock-icon-size'));
        this._box.add_child(icon);
        return icon;
    }

    _position() {
        if (!this._container || this._icons.length === 0)
            return;

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const iconSize = this._settings.get_int('dock-icon-size');
        const spacing = this._settings.get_int('dock-spacing');
        const padding = this._settings.get_int('dock-padding');
        const margin = this._settings.get_int('dock-margin');
        const width = dockWidth(this._icons.length, iconSize, spacing, padding);
        const height = dockHeight(iconSize, padding);
        const origin = dockOrigin(monitor, width, height, margin);

        this._shownY = origin.y;
        this._hiddenY = monitor.y + monitor.height - 2;
        this._box.set_style(`spacing: ${spacing}px; padding: ${padding}px;`);
        this._container.set_size(width, height);
        this._container.set_position(origin.x, this._forcedHidden ? this._hiddenY : this._shownY);
        this._container.visible = !this._forcedHidden;
    }

    disable() {
        for (const icon of this._icons)
            icon.destroy();
        this._icons = [];
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
        }
        this._container = null;
        this._background = null;
        this._box = null;
    }
}
```

- [ ] **Step 3: Run syntax and pack checks**

Run: `make test`
Expected: PASS for all pure tests and syntax checks.

Run: `make pack`
Expected: PASS.

- [ ] **Step 4: Manual dock check**

Install and log out and back in.

Check:

1. The dock appears bottom-centered with pinned favorites.
2. Launching an app adds its icon to the running group.
3. Left click focuses the app. Clicking a focused app minimizes its windows.
4. Middle click opens a new window when supported.
5. Disable the extension. The dock disappears and no actor remains.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/dock/dockIcon.js extension/src/modules/dock/dockModule.js
git commit -m "feat: add floating dock with app icons"
```

---

### Task 10: Dock autohide, intellihide, and magnification

**Files:**
- Modify: `extension/src/modules/dock/dockModule.js`
- Test: `tests/dock-layout.test.js`, `tests/dock-magnification.test.js`, manual dock checks

**Interfaces:**
- Consumes: `hiddenDockY`, `slotCenter`, `scalesForCenters`
- Produces: `DockModule.setForcedHidden(hidden)`
- Produces: dock reveal, hide, and magnification behavior

- [ ] **Step 1: Add the pure overlap helper and test**

Add to `extension/src/modules/dock/layout.js`:

```js
export function rectsOverlap(a, b) {
    return a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
}
```

Add to `tests/dock-layout.test.js`:

```js
import {rectsOverlap} from '../extension/src/modules/dock/layout.js';
import {assert} from './helpers.js';

assert(rectsOverlap(
    {x: 0, y: 700, width: 1000, height: 100},
    {x: 100, y: 650, width: 200, height: 100}
), 'dock overlap is detected');
assert(!rectsOverlap(
    {x: 0, y: 700, width: 1000, height: 100},
    {x: 100, y: 500, width: 200, height: 100}
), 'non-overlapping windows are ignored');
```

- [ ] **Step 2: Extend the dock module imports and fields**

Change the import block:

```js
import {HomescreenDockIcon} from './dockIcon.js';
import {
    dockHeight,
    dockOrigin,
    dockWidth,
    rectsOverlap,
    slotCenter,
} from './layout.js';
import {scalesForCenters} from './magnification.js';
```

Add fields in the constructor:

```js
this._hideSource = 0;
this._hoverLabel = null;
this._magnifying = false;
```

- [ ] **Step 3: Add visibility and magnification behavior**

Add these methods to `DockModule`:

```js
    _isPointerAtEdge() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const [, y] = global.get_pointer();
        return y >= monitor.y + monitor.height - 2;
    }

    _windowsOverlapDock() {
        if (!this._container || !this._settings.get_boolean('dock-intellihide'))
            return false;
        const rect = {
            x: this._container.x,
            y: this._shownY,
            width: this._container.width,
            height: this._container.height,
        };
        return global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window &&
                window.get_window_type() === Meta.WindowType.NORMAL &&
                !window.minimized)
            .some(window => {
                const frame = window.get_frame_rect();
                return rectsOverlap(rect, {
                    x: frame.x,
                    y: frame.y,
                    width: frame.width,
                    height: frame.height,
                });
            });
    }

    _showDock(animate = true) {
        if (this._forcedHidden)
            return;
        if (this._hideSource) {
            GLib.source_remove(this._hideSource);
            this._hideSource = 0;
        }
        this._container.show();
        this._container.remove_all_transitions();
        this._container.ease({
            y: this._shownY,
            duration: animate ? 140 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideDock(animate = true) {
        if (this._hideSource) {
            GLib.source_remove(this._hideSource);
            this._hideSource = 0;
        }
        this._container.remove_all_transitions();
        this._container.ease({
            y: this._hiddenY,
            duration: animate ? 180 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._forcedHidden && this._container.y === this._hiddenY)
                    this._container.hide();
            },
        });
    }

    _scheduleDockHide() {
        if (this._hideSource)
            GLib.source_remove(this._hideSource);
        const delay = this._settings.get_int('dock-hide-delay');
        this._hideSource = this._scope.timeout(delay, () => {
            this._hideSource = 0;
            if (this._isPointerAtEdge() || this._windowsOverlapDock())
                return GLib.SOURCE_REMOVE;
            this._hideDock(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _onStageMotion() {
        if (this._forcedHidden)
            return Clutter.EVENT_PROPAGATE;
        if (this._isPointerAtEdge())
            this._showDock(true);
        else if (this._container.visible &&
                 !this._container.hover &&
                 !this._windowsOverlapDock())
            this._scheduleDockHide();
        return Clutter.EVENT_PROPAGATE;
    }

    _resetMagnification() {
        for (const icon of this._icons) {
            icon.remove_all_transitions();
            icon.set_pivot_point(0.5, 1.0);
            icon.set_scale(1, 1);
        }
    }

    _updateMagnification() {
        if (!this._settings.get_boolean('dock-magnification') ||
            this._icons.length === 0) {
            this._resetMagnification();
            return;
        }
        const [pointerX] = global.get_pointer();
        const localX = pointerX - this._container.x;
        const iconSize = this._settings.get_int('dock-icon-size');
        const spacing = this._settings.get_int('dock-spacing');
        const padding = this._settings.get_int('dock-padding');
        const centers = this._icons.map((_icon, index) =>
            slotCenter(index, iconSize, spacing, padding));
        const scales = scalesForCenters(
            localX,
            centers,
            iconSize + spacing,
            this._settings.get_double('dock-magnification-strength'),
            1.4
        );
        this._icons.forEach((icon, index) => {
            icon.set_pivot_point(0.5, 1.0);
            icon.set_scale(scales[index], scales[index]);
        });
    }
```

- [ ] **Step 4: Wire visibility into enable, rebuild, and disable**

In `enable`, after the existing signals, add:

```js
        this._scope.signal(global.stage, 'motion-event', () => this._onStageMotion());
        this._scope.signal(this._settings, 'changed::dock-autohide', () => this._updateDockVisibility());
        this._scope.signal(this._settings, 'changed::dock-intellihide', () => this._updateDockVisibility());
        this._scope.signal(this._settings, 'changed::dock-magnification', () => this._updateMagnification());
        this._scope.signal(this._settings, 'changed::dock-magnification-strength', () => this._updateMagnification());
        this._scope.signal(this._container, 'enter-event', () => {
            this._showDock(true);
            return Clutter.EVENT_PROPAGATE;
        });
        this._scope.signal(this._container, 'leave-event', () => {
            this._resetMagnification();
            this._scheduleDockHide();
            return Clutter.EVENT_PROPAGATE;
        });
        this._scope.signal(this._container, 'motion-event', () => {
            this._updateMagnification();
            return Clutter.EVENT_PROPAGATE;
        });
```

Add `_updateDockVisibility`:

```js
    _updateDockVisibility() {
        if (!this._settings.get_boolean('dock-autohide') ||
            this._windowsOverlapDock()) {
            this._hideDock(false);
            return;
        }
        this._showDock(false);
    }
```

In `_position`, after setting positions, add:

```js
        this._hiddenY = hiddenDockY(monitor, margin);
        this._updateDockVisibility();
```

Change the import from `layout.js` to include `hiddenDockY`.

In `setForcedHidden`, replace the method with:

```js
    setForcedHidden(hidden) {
        this._forcedHidden = hidden;
        if (hidden)
            this._hideDock(false);
        else
            this._updateDockVisibility();
    }
```

In `disable`, before destroying the container, add:

```js
        this._resetMagnification();
        if (this._hideSource) {
            GLib.source_remove(this._hideSource);
            this._hideSource = 0;
        }
```

- [ ] **Step 5: Run tests and pack**

Run: `gjs -m tests/dock-layout.test.js`
Expected: PASS with the new overlap assertions.

Run: `gjs -m tests/dock-magnification.test.js`
Expected: PASS.

Run: `make pack`
Expected: PASS.

- [ ] **Step 6: Manual dock motion check**

Check:

1. Dock hides after the delay when the pointer leaves.
2. Move the pointer to the bottom edge. Dock reveals.
3. Hovering icons magnifies the nearest icons without moving the dock.
4. Move the pointer away. Icons return to normal size and the dock hides.
5. Open a window at the bottom edge with intellihide on. Dock stays hidden.

- [ ] **Step 7: Commit**

```bash
git add extension/src/modules/dock/dockModule.js extension/src/modules/dock/layout.js tests/dock-layout.test.js
git commit -m "feat: add dock autohide and magnification"
```

---

### Task 11: Desktop module

**Files:**
- Create: `extension/src/modules/desktop/ding.js`
- Modify: `extension/src/modules/desktop/desktopModule.js`
- Test: `tests/desktop.test.js`

**Interfaces:**
- Produces: `DING_KEYS`
- Produces: `snapshotDing(settings): object`
- Produces: `hideDingIcons(settings): void`
- Produces: `restoreDing(settings, snapshot): void`
- Produces: `DesktopModule.enable(context)`, `disable()`

- [ ] **Step 1: Write the failing desktop tests**

`tests/desktop.test.js`:

```js
import {
    DING_KEYS,
    hideDingIcons,
    restoreDing,
    snapshotDing,
} from '../extension/src/modules/desktop/ding.js';
import {assertEqual} from './helpers.js';

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
}

const settings = new FakeSettings({
    'show-home': true,
    'show-trash': true,
    'show-volumes': true,
    'show-network-volumes': true,
});

const snapshot = snapshotDing(settings);
assertEqual(snapshot['show-home'], true, 'snapshot captures the original value');
hideDingIcons(settings);
for (const key of DING_KEYS)
    assertEqual(settings.get_boolean(key), false, `${key} is hidden`);
restoreDing(settings, snapshot);
for (const key of DING_KEYS)
    assertEqual(settings.get_boolean(key), true, `${key} is restored`);

print('desktop tests passed');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `gjs -m tests/desktop.test.js`
Expected: FAIL with a module-not-found error

- [ ] **Step 3: Implement the DING helpers**

`extension/src/modules/desktop/ding.js`:

```js
export const DING_KEYS = [
    'show-home',
    'show-trash',
    'show-volumes',
    'show-network-volumes',
];

export function snapshotDing(settings) {
    return Object.fromEntries(
        DING_KEYS.map(key => [key, settings.get_boolean(key)])
    );
}

export function hideDingIcons(settings) {
    for (const key of DING_KEYS)
        settings.set_boolean(key, false);
}

export function restoreDing(settings, snapshot) {
    for (const key of DING_KEYS) {
        if (typeof snapshot[key] === 'boolean')
            settings.set_boolean(key, snapshot[key]);
    }
}
```

- [ ] **Step 4: Implement the desktop module**

`extension/src/modules/desktop/desktopModule.js`:

```js
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {hideDingIcons, restoreDing, snapshotDing} from './ding.js';

const DING_SCHEMA = 'org.gnome.shell.extensions.ding';
const ACTION_MODE = Shell.ActionMode.NORMAL;

export class DesktopModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._ding = null;
        this._dingSnapshot = null;
        this._focusMode = false;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._context = context;

        this._ding = this._findDingSettings();
        if (this._ding) {
            this._dingSnapshot = snapshotDing(this._ding);
            this._applyIcons();
        }

        this._scope.signal(this._settings, 'changed::desktop-hide-icons', () => this._applyIcons());
        this._scope.signal(this._settings, 'changed::desktop-focus-mode', () => this._applyFocusMode());
        this._scope.signal(this._settings, 'changed::desktop-show-desktop-shortcut', () => this._rebindShortcut());

        this._bindShortcut();
        this._applyFocusMode();
    }

    _findDingSettings() {
        try {
            const source = Gio.SettingsSchemaSource.get_default();
            const schema = source.lookup(DING_SCHEMA, true);
            return schema ? new Gio.Settings({settings_schema: schema}) : null;
        } catch {
            return null;
        }
    }

    _applyIcons() {
        if (!this._ding)
            return;
        if (this._settings.get_boolean('desktop-hide-icons'))
            hideDingIcons(this._ding);
        else
            restoreDing(this._ding, this._dingSnapshot);
    }

    _applyFocusMode() {
        this._focusMode = this._settings.get_boolean('desktop-focus-mode');
        this._context.getModule('panel')?.setForcedHidden(this._focusMode);
        this._context.getModule('dock')?.setForcedHidden(this._focusMode);
    }

    _bindShortcut() {
        Main.wm.addKeybinding(
            'desktop-show-desktop-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            ACTION_MODE,
            () => this._toggleDesktop()
        );
    }

    _rebindShortcut() {
        Main.wm.removeKeybinding('desktop-show-desktop-shortcut');
        this._bindShortcut();
    }

    _toggleDesktop() {
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window &&
                window.get_window_type() === Meta.WindowType.NORMAL);
        const anyVisible = windows.some(window => !window.minimized);
        for (const window of windows) {
            if (anyVisible)
                window.minimize();
            else
                window.unminimize();
        }
    }

    disable() {
        Main.wm.removeKeybinding('desktop-show-desktop-shortcut');
        this._context?.getModule('panel')?.setForcedHidden(false);
        this._context?.getModule('dock')?.setForcedHidden(false);
        if (this._ding && this._dingSnapshot)
            restoreDing(this._ding, this._dingSnapshot);
        this._ding = null;
        this._dingSnapshot = null;
        this._context = null;
    }
}
```

- [ ] **Step 5: Run the test and pack**

Run: `gjs -m tests/desktop.test.js`
Expected: PASS with `desktop tests passed`

Run: `make pack`
Expected: PASS.

- [ ] **Step 6: Manual desktop check**

Check:

1. Desktop icons are hidden while the module is enabled.
2. Disable the extension. Original DING icon settings return.
3. Turn on focus mode. Panel and dock hide.
4. Turn off focus mode. Panel and dock return to their normal behavior.
5. Set a Show Desktop shortcut, press it, and confirm windows minimize and restore.

- [ ] **Step 7: Commit**

```bash
git add extension/src/modules/desktop/ding.js extension/src/modules/desktop/desktopModule.js tests/desktop.test.js
git commit -m "feat: add clean desktop and focus mode"
```

---

### Task 12: Dock and desktop preferences pages

**Files:**
- Create: `extension/src/prefs/dockPage.js`
- Create: `extension/src/prefs/desktopPage.js`
- Modify: `extension/prefs.js`
- Test: `make pack`

**Interfaces:**
- Consumes: `switchRow`, `spinRow`, `comboRow`, `shortcutRow`
- Produces: `buildDockPage(window, settings)`, `buildDesktopPage(window, settings)`

- [ ] **Step 1: Write the dock page**

`extension/src/prefs/dockPage.js`:

```js
import Adw from 'gi://Adw';

import {comboRow, spinRow, switchRow} from './helpers.js';

export function buildDockPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Dock',
        icon_name: 'view-app-grid-symbolic',
    });
    window.add(page);

    const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
    page.add(behavior);
    behavior.add(comboRow(settings, 'dock-position', 'Position', ['bottom']));
    behavior.add(switchRow(settings, 'dock-autohide', 'Auto hide',
        'Hide the dock when the pointer leaves it.'));
    behavior.add(switchRow(settings, 'dock-intellihide', 'Intellihide',
        'Hide the dock when a window overlaps it.'));

    const size = new Adw.PreferencesGroup({title: 'Size and spacing'});
    page.add(size);
    size.add(spinRow(settings, 'dock-icon-size', 'Icon size',
        'Pixels.', 32, 72, 2));
    size.add(spinRow(settings, 'dock-spacing', 'Icon spacing',
        'Pixels between icons.', 4, 16, 1));
    size.add(spinRow(settings, 'dock-padding', 'Inner padding',
        'Pixels around the icons.', 4, 20, 1));
    size.add(spinRow(settings, 'dock-margin', 'Screen margin',
        'Pixels from the bottom edge.', 4, 24, 1));
    size.add(spinRow(settings, 'dock-radius', 'Corner radius',
        'Pixels.', 16, 32, 1));

    const motion = new Adw.PreferencesGroup({title: 'Motion'});
    page.add(motion);
    motion.add(switchRow(settings, 'dock-magnification', 'Magnification',
        'Scale icons near the pointer.'));
    motion.add(spinRow(settings, 'dock-hide-delay', 'Hide delay',
        'Milliseconds after the pointer leaves.', 0, 2000, 50));

    return page;
}
```

The radius and opacity keys are stored now and used by the stylesheet task. Add the opacity control in that task.

- [ ] **Step 2: Write the desktop page**

`extension/src/prefs/desktopPage.js`:

```js
import Adw from 'gi://Adw';

import {shortcutRow, switchRow} from './helpers.js';

export function buildDesktopPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Desktop',
        icon_name: 'user-desktop-symbolic',
    });
    window.add(page);

    const desktop = new Adw.PreferencesGroup({title: 'Desktop'});
    page.add(desktop);
    desktop.add(switchRow(settings, 'desktop-hide-icons', 'Hide desktop icons',
        'Keep DING icons hidden while Homescreen is enabled.'));
    desktop.add(switchRow(settings, 'desktop-focus-mode', 'Focus mode',
        'Hide the panel and dock.'));
    desktop.add(shortcutRow(settings, 'desktop-show-desktop-shortcut',
        'Show desktop shortcut'));

    return page;
}
```

- [ ] **Step 3: Wire both pages into preferences**

`extension/prefs.js`:

```js
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildDesktopPage} from './src/prefs/desktopPage.js';
import {buildDockPage} from './src/prefs/dockPage.js';
import {buildPanelPage} from './src/prefs/panelPage.js';

export default class HomescreenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(800, 680);
        window.set_title(_('Homescreen'));
        const settings = this.getSettings();
        buildPanelPage(window, settings);
        buildDockPage(window, settings);
        buildDesktopPage(window, settings);
    }
}
```

- [ ] **Step 4: Run syntax and pack checks**

Run: `make test`
Expected: PASS.

Run: `make pack`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/prefs/dockPage.js extension/src/prefs/desktopPage.js extension/prefs.js
git commit -m "feat: add dock and desktop preferences"
```

---

### Task 13: Stylesheet and visual base

**Files:**
- Modify: `extension/stylesheet.css`
- Test: `tests/stylesheet.test.js`

**Interfaces:**
- Consumes: class names from the panel and dock modules
- Produces: `homescreen-panel`, `homescreen-dock`, `homescreen-dock-background`, `homescreen-dock-box`, `homescreen-dock-icon`, `homescreen-running`, `homescreen-dock-label`

- [ ] **Step 1: Write the failing stylesheet test**

`tests/stylesheet.test.js`:

```js
import GLib from 'gi://GLib';

import {assert} from './helpers.js';

const path = GLib.build_filenamev([GLib.get_current_dir(), 'extension', 'stylesheet.css']);
const [ok, bytes] = GLib.file_get_contents(path);
assert(ok, 'stylesheet exists');
const css = new TextDecoder().decode(bytes);

for (const selector of [
    '.homescreen-panel',
    '.homescreen-dock',
    '.homescreen-dock-background',
    '.homescreen-dock-box',
    '.homescreen-dock-icon',
    '.homescreen-running',
]) {
    assert(css.includes(selector), `missing ${selector}`);
}

print('stylesheet tests passed');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `gjs -m tests/stylesheet.test.js`
Expected: FAIL with `missing .homescreen-panel`

- [ ] **Step 3: Write the stylesheet**

`extension/stylesheet.css`:

```css
.homescreen-panel {
    background-color: rgba(28, 28, 30, 0.72);
    border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}

.homescreen-dock {
    margin: 0;
}

.homescreen-dock-background {
    background-color: rgba(28, 28, 30, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 24px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.homescreen-dock-box {
    spacing: 8px;
    padding: 10px;
}

.homescreen-dock-icon {
    border-radius: 12px;
}

.homescreen-dock-icon:hover {
    background-color: rgba(255, 255, 255, 0.08);
}

.homescreen-running .app-grid-running-dot {
    background-color: #e95420;
    width: 4px;
    height: 4px;
    border-radius: 2px;
    margin-bottom: 2px;
}

.homescreen-dock .app-grid-running-dot {
    background-color: rgba(255, 255, 255, 0.36);
    width: 4px;
    height: 4px;
    border-radius: 2px;
    margin-bottom: 2px;
}

.homescreen-dock .homescreen-running .app-grid-running-dot {
    background-color: #e95420;
}

.homescreen-dock-label {
    background-color: rgba(0, 0, 0, 0.78);
    color: #ffffff;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11px;
}
```

- [ ] **Step 4: Run the test and pack**

Run: `gjs -m tests/stylesheet.test.js`
Expected: PASS with `stylesheet tests passed`

Run: `make pack`
Expected: PASS.

- [ ] **Step 5: Manual visual check**

Check:

1. Panel background is translucent, not solid black.
2. Dock background is a floating rounded rectangle with a border and shadow.
3. Running apps show an orange dot.
4. Hovering a dock icon does not cause a layout jump.
5. Disable the extension. Panel and dock styles are gone.

- [ ] **Step 6: Commit**

```bash
git add extension/stylesheet.css tests/stylesheet.test.js
git commit -m "feat: add panel and dock styles"
```

---

### Task 14: Install probe, cycle script, and full check

**Files:**
- Create: `tests/headless-install-probe.sh`
- Create: `scripts/cycle-extension.sh`
- Modify: `Makefile`
- Test: `make check`

**Interfaces:**
- Consumes: packaged zip from `make pack`
- Produces: `make check` that validates metadata, tests, packaging, install, and uninstall

- [ ] **Step 1: Write the install probe**

`tests/headless-install-probe.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${HOMESCREEN_PROBE_BASE:-/tmp/opencode/homescreen-install-probe}"
UUID="homescreen@engida32.github.io"
PACK="$ROOT/dist/$UUID.shell-extension.zip"

rm -rf "$BASE"
mkdir -p "$BASE/home" "$BASE/data" "$BASE/config" "$BASE/cache"

export HOME="$BASE/home"
export XDG_DATA_HOME="$BASE/data"
export XDG_CONFIG_HOME="$BASE/config"
export XDG_CACHE_HOME="$BASE/cache"

test -f "$PACK"

gnome-extensions install --force "$PACK"
gnome-extensions info "$UUID" | grep -q "$UUID"

gnome-extensions enable "$UUID" || true
gnome-extensions disable "$UUID" || true

gnome-extensions uninstall "$UUID"
echo "PROBE_OK"
```

Make it executable:

```bash
chmod +x tests/headless-install-probe.sh
```

- [ ] **Step 2: Write the live cycle script**

`scripts/cycle-extension.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

UUID="homescreen@engida32.github.io"
CYCLES="${1:-20}"

for i in $(seq 1 "$CYCLES"); do
    gnome-extensions disable "$UUID" || true
    gnome-extensions enable "$UUID"
    sleep 0.3
done

echo "Cycled $UUID $CYCLES times"
echo "Now check: journalctl -f -o cat /usr/bin/gnome-shell"
```

Make it executable:

```bash
chmod +x scripts/cycle-extension.sh
```

- [ ] **Step 3: Add the probe to `make check`**

`Makefile` `check` target already calls `bash tests/headless-install-probe.sh`. Confirm it is present.

- [ ] **Step 4: Run the full check**

Run: `make check`
Expected: PASS, ending with `PROBE_OK`.

- [ ] **Step 5: Run the live cycle test manually**

Install and enable the extension in your session, then run:

```bash
./scripts/cycle-extension.sh 20
```

Watch the Shell log in a second terminal:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Expected: no repeated errors, no warnings about disconnected signals, and the panel and dock return after every cycle.

- [ ] **Step 6: Commit**

```bash
git add tests/headless-install-probe.sh scripts/cycle-extension.sh Makefile
git commit -m "test: add install probe and cycle script"
```

---

## Phase 1 Acceptance

Run these checks in order:

```bash
make check
./scripts/cycle-extension.sh 20
```

Then log out and back in on Wayland and verify:

- Panel hides, reveals, and returns to the correct position.
- Dock floats bottom-center, launches and focuses apps, magnifies, and autohides.
- Desktop icons are hidden while enabled and restored after disable.
- Focus mode hides the panel and dock.
- Preferences changes apply without a restart.
- Disabling the extension leaves no dock actor, panel style, keybinding, or DING change behind.

## Deferred to Later Plans

- Lockscreen module.
- Blur, rounded window corners, and animation presets.
- Tiling.
- System monitor.
- App grid and Launchpad mode.
- Dock left and right positions, window previews, badges, drag reorder, and per-monitor docks.
- Presets, export and import, and the full diagnostics page.
