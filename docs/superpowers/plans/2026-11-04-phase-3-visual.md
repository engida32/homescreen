# Phase 3: Visual Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in visual module that blurs the panel and dock with GNOME Shell's native blur effect, lowers the panel glass opacity while blurred, and exposes the behavior in preferences without disturbing stock appearance when disabled.

**Architecture:** A pure `BlurController` owns effect lifecycle and scaling, so it can be unit tested without Shell. A thin `VisualModule` connects settings, the panel actor, and the dock background actor to that controller. The dock style becomes blur-aware, and the panel gets one additional CSS class while blurred. The module is registered last among the top-level modules so the dock exists before visual sync runs.

**Tech Stack:** GJS, GNOME Shell 50.1, `Shell.BlurEffect`, GSettings, GTK4/Adw preferences, GPLv3.

**Spec:** `DESIGN.md`

## Global Constraints

- GNOME Shell 50.1 on Wayland only. Metadata `shell-version` stays `["50"]`.
- UUID: `homescreen@engida32.github.io`. Schema: `org.gnome.shell.extensions.homescreen`.
- No synchronous file I/O or synchronous D-Bus on the Shell main loop.
- Every signal, timeout, and actor is owned by a `ModuleScope` and released in `disable()`.
- Private Shell APIs need a comment naming GNOME Shell 50.1 and the verified file.
- Visual effects are opt-in. Disabling the module or the extension restores shell behavior and the stock panel and dock surfaces.
- `make check` must stay green after every task.

## Review Focus

- Applying blur twice must update the same effect instead of stacking a second effect with the same name.
- Turning panel blur off must remove both the effect and the `homescreen-panel-blurred` class.
- Turning dock blur off must restore the dock background opacity even after the dock has been rebuilt.
- A missing dock background must not leave the dock transparent without a blur effect.
- A scale factor change must update the radius of every active effect.

---

### Task 1: Pure blur controller

**Files:**
- Create: `extension/src/modules/visual/blur.js`
- Test: `tests/blur.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BlurController` with `constructor({effectFactory, scaleFactor = 1})`, `apply(actor, {name, radius, brightness, mode})`, `remove(actor, name)`, `removeAll()`, and `setScaleFactor(scaleFactor)`.

- [ ] **Step 1: Write the failing test**

```javascript
import {BlurController} from '../extension/src/modules/visual/blur.js';
import {assert, assertEqual} from './helpers.js';

function makeEffect() {
    return {
        radius: null,
        brightness: null,
        mode: null,
        set_radius(value) {
            this.radius = value;
        },
        set_brightness(value) {
            this.brightness = value;
        },
        set_mode(value) {
            this.mode = value;
        },
    };
}

function makeActor() {
    return {
        effects: new Map(),
        add_effect_with_name(name, effect) {
            this.effects.set(name, effect);
        },
        remove_effect_by_name(name) {
            this.effects.delete(name);
        },
        get_effect(name) {
            return this.effects.get(name) ?? null;
        },
    };
}

const effects = [];
const controller = new BlurController({
    effectFactory: name => {
        const effect = makeEffect();
        effect.name = name;
        effects.push(effect);
        return effect;
    },
    scaleFactor: 2,
});
const actor = makeActor();

controller.apply(actor, {name: 'homescreen-blur', radius: 30, brightness: 0.65, mode: 1});
assertEqual(effects.length, 1, 'one effect created');
assertEqual(effects[0].name, 'homescreen-blur', 'effect name');
assertEqual(effects[0].radius, 60, 'radius scaled by scale factor');
assertEqual(effects[0].brightness, 0.65, 'brightness applied');
assertEqual(effects[0].mode, 1, 'mode applied');
assert(actor.get_effect('homescreen-blur') === effects[0], 'effect added to actor');

controller.apply(actor, {name: 'homescreen-blur', radius: 40, brightness: 0.5, mode: 1});
assertEqual(effects.length, 1, 'second apply reuses the effect');
assertEqual(effects[0].radius, 80, 'second apply updates radius');
assertEqual(effects[0].brightness, 0.5, 'second apply updates brightness');

controller.setScaleFactor(1);
assertEqual(effects[0].radius, 40, 'scale change updates stored radius');

const secondActor = makeActor();
controller.apply(secondActor, {name: 'homescreen-blur', radius: 20, brightness: 0.65, mode: 1});
assertEqual(effects.length, 2, 'second actor gets its own effect');

controller.remove(actor, 'homescreen-blur');
assert(actor.get_effect('homescreen-blur') === null, 'remove deletes effect');
assert(secondActor.get_effect('homescreen-blur') !== null, 'remove leaves other actors alone');

controller.removeAll();
assert(secondActor.get_effect('homescreen-blur') === null, 'removeAll deletes remaining effects');

print('blur tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/blur.test.js`

Expected: FAIL because `extension/src/modules/visual/blur.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```javascript
export class BlurController {
    constructor({effectFactory, scaleFactor = 1}) {
        if (typeof effectFactory !== 'function')
            throw new Error('BlurController requires an effectFactory');
        this._effectFactory = effectFactory;
        this._scaleFactor = scaleFactor || 1;
        this._effects = new Map();
    }

    setScaleFactor(scaleFactor) {
        this._scaleFactor = scaleFactor || 1;
        for (const effects of this._effects.values()) {
            for (const entry of effects.values())
                entry.effect.set_radius(entry.radius * this._scaleFactor);
        }
    }

    apply(actor, {name = 'homescreen-blur', radius = 30, brightness = 0.65, mode} = {}) {
        if (!actor)
            return;

        let effects = this._effects.get(actor);
        if (!effects) {
            effects = new Map();
            this._effects.set(actor, effects);
        }

        let entry = effects.get(name);
        if (!entry) {
            const existing = actor.get_effect?.(name);
            if (existing) {
                entry = {effect: existing, radius};
            } else {
                const effect = this._effectFactory(name);
                actor.add_effect_with_name(name, effect);
                entry = {effect, radius};
            }
            effects.set(name, entry);
        }

        entry.radius = radius;
        entry.effect.set_radius(radius * this._scaleFactor);
        entry.effect.set_brightness(brightness);
        if (mode !== undefined)
            entry.effect.set_mode(mode);
    }

    remove(actor, name = 'homescreen-blur') {
        if (!actor)
            return;
        const effects = this._effects.get(actor);
        if (!effects)
            return;
        const entry = effects.get(name);
        if (!entry)
            return;

        try {
            actor.remove_effect_by_name(name);
        } catch {
            // The actor may already be destroyed.
        }
        effects.delete(name);
        if (effects.size === 0)
            this._effects.delete(actor);
    }

    removeAll() {
        for (const [actor, effects] of this._effects) {
            for (const name of effects.keys()) {
                try {
                    actor.remove_effect_by_name(name);
                } catch {
                    // The actor may already be destroyed.
                }
            }
        }
        this._effects.clear();
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/blur.test.js`

Expected: PASS, prints `blur tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/visual/blur.js tests/blur.test.js
git commit -m "feat: add blur controller"
```

---

### Task 2: Blur-aware dock background

**Files:**
- Modify: `extension/src/modules/dock/dockStyle.js`
- Modify: `extension/src/modules/dock/dockModule.js`
- Modify: `tests/stylesheet.test.js`

**Interfaces:**
- Consumes: `dockBackgroundStyle(radius, opacity)` from earlier phases.
- Produces: `dockBackgroundStyle(radius, opacity, blurred = false)`; `DockModule.getBackgroundActor()` returns `St.Widget | null`; `DockModule.setBlurred(blurred)` updates the background without rebuilding icons.

- [ ] **Step 1: Write the failing test**

Replace the two `dockBackgroundStyle` assertions in `tests/stylesheet.test.js` with:

```javascript
assertEqual(
    dockBackgroundStyle(24, 0.72),
    'border-radius: 24px; background-color: rgba(28, 28, 30, 0.72);',
    'dock background style'
);

assertEqual(
    dockBackgroundStyle(24, 0.72, true),
    'border-radius: 24px; background-color: rgba(28, 28, 30, 0);',
    'blurred dock background is transparent'
);

assertEqual(
    dockBackgroundStyle(32, 1.0),
    'border-radius: 32px; background-color: rgba(28, 28, 30, 1);',
    'dock background style at max radius and opacity'
);
```

Add `'#panel.homescreen-panel-blurred'` to the selector list in the same file.

- [ ] **Step 2: Run test to verify it fails**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/stylesheet.test.js`

Expected: FAIL because `dockBackgroundStyle` ignores the third argument and the stylesheet lacks the new selector.

- [ ] **Step 3: Write minimal implementation**

`extension/src/modules/dock/dockStyle.js`:

```javascript
export function dockBackgroundStyle(radius, opacity, blurred = false) {
    const color = blurred ? 'rgba(28, 28, 30, 0)' : `rgba(28, 28, 30, ${opacity})`;
    return `border-radius: ${Math.round(radius)}px; background-color: ${color};`;
}
```

In `extension/src/modules/dock/dockModule.js`:

- Add `this._blurred = false;` in the constructor.
- Add these methods before `_destroyActors()`:

```javascript
    getBackgroundActor() {
        return this._background;
    }

    setBlurred(blurred) {
        if (this._blurred === blurred)
            return;
        this._blurred = blurred;
        this._position();
    }
```

- Change the `_position()` style call to:

```javascript
        this._background.set_style(dockBackgroundStyle(
            this._settings.get_int('dock-radius'),
            this._settings.get_double('dock-opacity'),
            this._blurred));
```

- Add `this._blurred = false;` inside `_destroyActors()` before clearing the actors.

Add this stylesheet rule after the existing panel background rule:

```css
#panel.homescreen-panel-blurred,
#panel.homescreen-panel-blurred:overview {
    background-color: rgba(28, 28, 30, 0.32) !important;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/stylesheet.test.js`

Expected: PASS, prints `stylesheet tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/dock/dockStyle.js extension/src/modules/dock/dockModule.js extension/stylesheet.css tests/stylesheet.test.js
git commit -m "feat: make dock background blur-aware"
```

---

### Task 3: Visual module and settings

**Files:**
- Create: `extension/src/modules/visual/visualModule.js`
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`
- Modify: `extension/extension.js`

**Interfaces:**
- Consumes: `BlurController` from Task 1, `DockModule.getBackgroundActor()` and `DockModule.setBlurred()` from Task 2.
- Produces: `VisualModule.enable(context)` and `VisualModule.disable()`. Settings keys `visual-enabled`, `visual-blur-panel`, `visual-blur-dock`, `visual-blur-radius`, and `visual-blur-brightness`.

- [ ] **Step 1: Establish the baseline**

This task wires Shell actors, so the behavior is covered by schema compilation, import resolution, and a manual preferences check. There is no headless unit test for the Shell integration.

Run: `make test`

Expected: PASS before the change.

- [ ] **Step 2: Add the schema keys**

Insert before `diagnostics-json` in the schema:

```xml
    <key name="visual-enabled" type="b">
      <default>false</default>
      <summary>Enable visual effects</summary>
    </key>
    <key name="visual-blur-panel" type="b">
      <default>false</default>
      <summary>Blur behind the panel</summary>
    </key>
    <key name="visual-blur-dock" type="b">
      <default>false</default>
      <summary>Blur behind the dock</summary>
    </key>
    <key name="visual-blur-radius" type="i">
      <default>30</default>
      <range min="8" max="64"/>
      <summary>Blur radius in pixels</summary>
    </key>
    <key name="visual-blur-brightness" type="d">
      <default>0.65</default>
      <range min="0.0" max="1.0"/>
      <summary>Blur brightness</summary>
    </key>
```

- [ ] **Step 3: Write the visual module**

Create `extension/src/modules/visual/visualModule.js`:

```javascript
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BlurController} from './blur.js';

const BLUR_NAME = 'homescreen-blur';
const PANEL_CLASS = 'homescreen-panel-blurred';
const SETTINGS_KEYS = [
    'visual-blur-panel',
    'visual-blur-dock',
    'visual-blur-radius',
    'visual-blur-brightness',
];

export class VisualModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._context = null;
        this._controller = null;
        this._themeContext = null;
        this._panel = null;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._context = context;
        this._panel = Main.panel ?? null;
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._controller = new BlurController({
            effectFactory: name => new Shell.BlurEffect({name}),
            scaleFactor: this._themeContext.scale_factor || 1,
        });

        for (const key of SETTINGS_KEYS)
            this._scope.signal(this._settings, `changed::${key}`, () => this._sync());

        this._scope.signal(this._themeContext, 'notify::scale-factor', () => {
            this._controller?.setScaleFactor(this._themeContext.scale_factor || 1);
        });

        this._sync();
    }

    _sync() {
        this._syncPanel();
        this._syncDock();
    }

    _syncPanel() {
        const blur = this._settings.get_boolean('visual-blur-panel');
        if (!this._panel)
            return;

        if (!blur) {
            this._controller.remove(this._panel, BLUR_NAME);
            this._panel.remove_style_class_name(PANEL_CLASS);
            return;
        }

        try {
            this._controller.apply(this._panel, {
                name: BLUR_NAME,
                radius: this._settings.get_int('visual-blur-radius'),
                brightness: this._settings.get_double('visual-blur-brightness'),
                // Shell.BlurMode.BACKGROUND blurs pixels beneath the actor,
                // not the panel text. Verified against GNOME Shell 50.1.
                mode: Shell.BlurMode.BACKGROUND,
            });
            this._panel.add_style_class_name(PANEL_CLASS);
        } catch (error) {
            this._controller.remove(this._panel, BLUR_NAME);
            this._panel.remove_style_class_name(PANEL_CLASS);
            this._context.logger.error('panel blur failed', error);
        }
    }

    _syncDock() {
        const dock = this._context.getModule('dock');
        const background = dock?.getBackgroundActor?.() ?? null;
        const requested = this._settings.get_boolean('visual-blur-dock');

        if (!requested) {
            if (background)
                this._controller.remove(background, BLUR_NAME);
            dock?.setBlurred?.(false);
            return;
        }

        let applied = false;
        if (background) {
            try {
                this._controller.apply(background, {
                    name: BLUR_NAME,
                    radius: this._settings.get_int('visual-blur-radius'),
                    brightness: this._settings.get_double('visual-blur-brightness'),
                    mode: Shell.BlurMode.BACKGROUND,
                });
                applied = true;
            } catch (error) {
                this._context.logger.error('dock blur failed', error);
            }
        }

        dock?.setBlurred?.(applied);
    }

    disable() {
        this._controller?.removeAll();
        try {
            this._panel?.remove_style_class_name(PANEL_CLASS);
        } catch {
            // The panel may already be gone during shell shutdown.
        }
        try {
            this._context?.getModule('dock')?.setBlurred?.(false);
        } catch {
            // Best-effort cleanup.
        }
        this._controller = null;
        this._themeContext = null;
        this._panel = null;
        this._context = null;
        this._settings = null;
        this._scope = null;
    }
}
```

- [ ] **Step 4: Register the module after the dock**

In `extension/extension.js`, import the module and add it after the dock registration:

```javascript
import {VisualModule} from './src/modules/visual/visualModule.js';
```

```javascript
        this._registry.add('dock', new DockModule(), 'dock-enabled');
        this._registry.add('visual', new VisualModule(), 'visual-enabled');
```

- [ ] **Step 5: Run checks**

Run: `make test`

Expected: PASS. The schema compiles and every relative import resolves.

- [ ] **Step 6: Commit**

```bash
git add extension/src/modules/visual/visualModule.js extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml extension/extension.js
git commit -m "feat: add opt-in visual blur module"
```

---

### Task 4: Visual preferences page

**Files:**
- Create: `extension/src/prefs/visualPage.js`
- Modify: `extension/prefs.js`

**Interfaces:**
- Consumes: settings keys from Task 3 and helpers `switchRow`, `spinRow`, `spinRowDouble`.
- Produces: `buildVisualPage(window, settings)`.

- [ ] **Step 1: Write the failing test**

Run: `make test`

Expected: PASS before the change. There is no prefs unit test. The new page is verified by import resolution and by opening preferences manually later.

- [ ] **Step 2: Create the page**

Create `extension/src/prefs/visualPage.js`:

```javascript
import Adw from 'gi://Adw';

import {spinRow, spinRowDouble, switchRow} from './helpers.js';

export function buildVisualPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Visual',
        icon_name: 'preferences-desktop-display-symbolic',
    });
    window.add(page);

    const general = new Adw.PreferencesGroup({title: 'General'});
    page.add(general);
    general.add(switchRow(settings, 'visual-enabled', 'Enable visual effects',
        'Applies when the extension is re-enabled.'));

    const blur = new Adw.PreferencesGroup({title: 'Blur'});
    page.add(blur);
    blur.add(switchRow(settings, 'visual-blur-panel', 'Blur behind the panel',
        'Uses the native Shell blur effect and lowers the panel opacity.'));
    blur.add(switchRow(settings, 'visual-blur-dock', 'Blur behind the dock',
        'Uses the native Shell blur effect and clears the dock background color.'));
    blur.add(spinRow(settings, 'visual-blur-radius', 'Blur radius',
        'Pixels. Higher values are softer and more expensive.', 8, 64, 1));
    blur.add(spinRowDouble(settings, 'visual-blur-brightness', 'Blur brightness',
        'Darkens or brightens the blurred surface.', 0.0, 1.0, 0.01));

    return page;
}
```

- [ ] **Step 3: Add the page to preferences**

In `extension/prefs.js`:

```javascript
import {buildVisualPage} from './src/prefs/visualPage.js';
```

```javascript
        buildDockPage(window, settings);
        buildVisualPage(window, settings);
```

- [ ] **Step 4: Run checks**

Run: `make check`

Expected: PASS and end with `PROBE_OK`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/prefs/visualPage.js extension/prefs.js
git commit -m "feat: add visual preferences page"
```

---

### Task 5: Documentation, work graph, and final verification

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `docs/superpowers/plans/2026-11-04-phase-3-visual.md`
- Modify: `/home/emmrc-02/work-graph-source/Sessions/2026-11-04-homescreen-full-design.md`

**Interfaces:**
- Consumes: the completed visual module and tests.
- Produces: accurate status text and a recorded implementation outcome.

- [ ] **Step 1: Update README**

Add a Visual line to the feature list:

```markdown
- Visual: opt-in native blur behind the panel and dock, configurable radius and brightness, panel glass opacity.
```

Add a limit:

```markdown
- Blur uses `Shell.BlurEffect` in background mode. It is off by default because it costs GPU time. A fresh install still needs a logout and login on Wayland before the extension can be enabled.
```

- [ ] **Step 2: Update DESIGN status**

Change the status line to:

```markdown
Status: Phase 3 implemented, live verification pending
```

Add a note under the Phases table:

```markdown
Phase 3 implements panel and dock blur plus panel glass. Overview blur and Launchpad mode are deferred to Phase 5, where the app grid and overview are restructured. Motion presets remain deferred until they can be added without a second animation system.
```

- [ ] **Step 3: Record deviations in this plan**

If implementation differs from any snippet above, add a short `## Implementation corrections` section immediately after the `Spec` line and list the verified correction with the file that proves it. Do not leave a wrong snippet uncorrected.

- [ ] **Step 4: Update the work graph session**

Add a `Phase 3 Outcome` section to `/home/emmrc-02/work-graph-source/Sessions/2026-11-04-homescreen-full-design.md`:

```markdown
## Phase 3 Outcome

- Added a pure `BlurController` with scale-aware effect lifecycle tests.
- Added the opt-in `VisualModule` for panel and dock background blur.
- Made the dock background transparent only while a blur effect is applied.
- Added the Visual preferences page and five schema keys.
- Deferred overview blur and Launchpad mode to Phase 5.
- `make check` result: PASS with `PROBE_OK`.
```

Use the actual test result in the final line. If `make check` fails, record the failure instead of `PASS`.

- [ ] **Step 5: Run the full check**

Run: `make check`

Expected: PASS and end with `PROBE_OK`.

- [ ] **Step 6: Commit**

```bash
git add README.md DESIGN.md docs/superpowers/plans/2026-11-04-phase-3-visual.md
git commit -m "docs: record phase 3 visual status"
```

The work graph lives outside the repository, so it is not part of this commit.

---

## Self-Review

- Spec coverage: panel blur (Task 3), dock blur (Task 2 and 3), configurable radius and brightness (Task 3 and 4), panel glass (Task 2 and 3), opt-in behavior (Task 3), tests (Task 1 and 2), documentation (Task 5).
- Placeholders: none. Every code step contains the exact implementation.
- Type consistency: `BlurController.apply`, `remove`, `removeAll`, and `setScaleFactor` are defined once and used by `VisualModule` and tests. `getBackgroundActor` and `setBlurred` are defined in Task 2 and used in Task 3.
- Review focus coverage: duplicate effects (Task 1 test), panel class removal (Task 3 code), dock opacity restore (Task 2 test and Task 3 code), missing dock background (Task 3 `_syncDock`), scale changes (Task 1 test).

## Known deferrals

- Overview blur needs a private overview actor and is deferred to Phase 5.
- Launchpad mode needs app grid restructuring and is deferred to Phase 5.
- Motion presets need a second animation system and stay deferred.
- Live Wayland verification still requires a logout and login after install.
