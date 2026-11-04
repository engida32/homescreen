# Phase 5: System Monitor and App Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native panel system monitor and a configurable app grid, including alphabetical ordering, grid shape, labels, remote-search control, Launchpad mode, and overview blur.

**Architecture:** A pure monitor data layer parses `/proc` and `/sys` content and computes deltas. A UI module samples asynchronously through `Gio.File`, draws a Cairo sparkline, and exposes details in a panel menu. A pure app-grid layout layer produces alphabetical page maps; the module applies them to the private Shell `AppDisplay`, patches the overview show default for Launchpad mode, and restores every original value on disable. Overview blur reuses `BlurController` and applies an ACTOR blur to the wallpaper group only while the overview is visible.

**Tech Stack:** GJS, GNOME Shell 50.1, Mutter 18, GSettings, GTK4/Adw preferences, Cairo, GPLv3.

**Spec:** `DESIGN.md`

## Global Constraints

- GNOME Shell 50.1 on Wayland only. Metadata `shell-version` stays `["50"]`.
- UUID: `homescreen@engida32.github.io`. Schema: `org.gnome.shell.extensions.homescreen`.
- No synchronous file I/O or synchronous D-Bus on the Shell main loop.
- Every signal, timeout, and actor is owned by a `ModuleScope` and released in `disable()`.
- Private Shell APIs need a comment naming GNOME Shell 50.1 and the verified file.
- Disable restores stock app-grid layout, grid shape, labels, overview show behavior, search settings, and blur effects.
- `make check` must stay green after every task.

## Review Focus

- A failed or slow `/proc` or `/sys` read must leave the monitor visible with an em dash, not throw into the Shell.
- Disabling the monitor must remove the status-area button and cancel every pending sample.
- Alphabetical mode must not permanently overwrite `app-picker-layout`; disable restores the saved variant.
- Changing rows, columns, or icon size must not leave the old grid shape after disable.
- Launchpad mode must not break `Main.overview.show(ControlsState.WINDOW_PICKER)` callers.

---

### Task 1: Monitor parsers and sampler

**Files:**
- Create: `extension/src/modules/monitor/monitorData.js`
- Create: `extension/src/modules/monitor/monitorSampler.js`
- Test: `tests/monitor.test.js`

**Interfaces:**
- Produces: `parseCpuStat(text)`, `parseMemInfo(text)`, `parseNetDev(text)`, `parseThermal(text)`, `cpuUsage(previous, current)`, `networkRates(previous, current, elapsed)`, `diskUsage(size, free)`, `formatBytes(bytes)`, `formatPercent(value)`, `formatRate(bytesPerSecond)`, `formatTemperature(value)`, `sparklinePoints(values, width, height, min, max)`, and `MonitorSampler`.

- [ ] **Step 1: Write the failing test**

```javascript
import Gio from 'gi://Gio';
import {assert, assertEqual, waitFor} from './helpers.js';
import {
    cpuUsage,
    diskUsage,
    formatBytes,
    formatPercent,
    formatRate,
    formatTemperature,
    networkRates,
    parseCpuStat,
    parseMemInfo,
    parseNetDev,
    parseThermal,
    sparklinePoints,
} from '../extension/src/modules/monitor/monitorData.js';
import {MonitorSampler} from '../extension/src/modules/monitor/monitorSampler.js';

const statA = 'cpu  100 0 100 800 0 0 0 0 0 0\n';
const statB = 'cpu  150 0 150 900 0 0 0 0 0 0\n';
assertEqual(parseCpuStat(statA).total, 1000, 'cpu total');
assertEqual(parseCpuStat(statA).idle, 800, 'cpu idle');
assertEqual(cpuUsage(parseCpuStat(statA), parseCpuStat(statB)), 50, 'cpu percent');

const mem = parseMemInfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\n');
assertEqual(mem.totalBytes, 1024000, 'mem total');
assertEqual(mem.usedBytes, 768000, 'mem used');
assertEqual(mem.percent, 75, 'mem percent');

const net = parseNetDev('lo: 9 9 9 9 9 9 9 9 9 9\neth0: 100 0 0 0 0 0 0 0 200 0\n');
assertEqual(net.rxBytes, 100, 'net rx');
assertEqual(net.txBytes, 200, 'net tx');
const rates = networkRates({rxBytes: 0, txBytes: 0}, net, 2);
assertEqual(rates.rxPerSecond, 50, 'net rx rate');
assertEqual(rates.txPerSecond, 100, 'net tx rate');

assertEqual(parseThermal('65000\n'), 65, 'thermal millidegrees');
assertEqual(diskUsage(1000, 250).percent, 75, 'disk percent');
assertEqual(formatBytes(1536), '1.5 KB', 'bytes');
assertEqual(formatPercent(42.4), '42%', 'percent');
assertEqual(formatRate(1536), '1.5 KB/s', 'rate');
assertEqual(formatTemperature(64.6), '65 °C', 'temperature');
assertEqual(sparklinePoints([], 10, 10).length, 0, 'empty sparkline');
assertEqual(sparklinePoints([0, 100], 10, 10)[1][1], 0, 'sparkline top');

const sampler = new MonitorSampler({
    readFile: async path => {
        if (path === '/proc/stat') return statB;
        if (path === '/proc/meminfo') return 'MemTotal: 1000 kB\nMemAvailable: 500 kB\n';
        if (path === '/proc/net/dev') return net;
        if (path === '/sys/class/thermal/thermal_zone0/temp') return '42000\n';
        throw new Error('missing');
    },
    queryDisk: async () => ({size: 1000, free: 250}),
    now: () => 100,
});
const first = waitFor(sampler.sample());
assertEqual(first.memory.percent, 50, 'sampler memory');
assertEqual(first.temperature, 42, 'sampler temperature');
assertEqual(first.disk.percent, 75, 'sampler disk');
assertEqual(first.cpu.percent, 0, 'first cpu sample');

print('monitor tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/monitor.test.js`
Expected: FAIL with a missing module error.

- [ ] **Step 3: Implement the pure data layer**

Create `monitorData.js` with parsers that return `null` on invalid input. `parseCpuStat` sums the first eight numeric fields and adds idle plus iowait for idle. `parseMemInfo` prefers `MemAvailable` and falls back to free plus buffers plus cached. `parseNetDev` sums every non-`lo` interface and ignores malformed lines. `parseThermal` divides values above 1000 by 1000. `cpuUsage` clamps to 0-100. `networkRates` returns zero on missing data or non-positive elapsed time. `formatBytes` uses B, KB, MB, GB, TB with one decimal below 10. `sparklinePoints` clamps values and returns `[x, y]` pairs.

Create `monitorSampler.js`:

```javascript
export class MonitorSampler {
    constructor({readFile, queryDisk, now, diskPath = '/'}) {
        this._readFile = readFile;
        this._queryDisk = queryDisk;
        this._now = now;
        this._diskPath = diskPath;
        this._previousCpu = null;
        this._previousNet = null;
        this._previousAt = 0;
    }

    async sample() {
        const read = path => this._readFile(path).catch(() => null);
        const [statText, memText, netText, thermalText, disk] = await Promise.all([
            read('/proc/stat'),
            read('/proc/meminfo'),
            read('/proc/net/dev'),
            read('/sys/class/thermal/thermal_zone0/temp'),
            this._queryDisk().catch(() => null),
        ]);
        const stat = parseCpuStat(statText);
        const net = parseNetDev(netText);
        const at = this._now();
        const elapsed = at - this._previousAt;
        const result = {
            cpu: {percent: cpuUsage(this._previousCpu, stat)},
            memory: parseMemInfo(memText),
            network: networkRates(this._previousNet, net, elapsed),
            temperature: parseThermal(thermalText),
            disk: disk ? diskUsage(disk.size, disk.free) : null,
        };
        this._previousCpu = stat;
        this._previousNet = net;
        this._previousAt = at;
        return result;
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/monitor.test.js`
Expected: PASS with `monitor tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/monitor/monitorData.js extension/src/modules/monitor/monitorSampler.js tests/monitor.test.js
git commit -m "feat: add monitor data layer"
```

---

### Task 2: Monitor panel module, settings, and preferences

**Files:**
- Create: `extension/src/modules/monitor/monitorModule.js`
- Create: `extension/src/prefs/monitorPage.js`
- Modify: `extension/extension.js`
- Modify: `extension/prefs.js`
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`

**Interfaces:**
- Consumes: `MonitorSampler`, the data formatters, and `context.scope`.
- Produces: `MonitorModule` registered as `monitor` with `monitor-enabled`.

- [ ] **Step 1: Add schema keys**

Add before `diagnostics-json`:

```xml
<key name="monitor-enabled" type="b">
  <default>false</default>
  <summary>Enable the system monitor</summary>
</key>
<key name="monitor-interval" type="i">
  <default>2</default>
  <range min="1" max="10"/>
  <summary>Refresh interval in seconds</summary>
</key>
<key name="monitor-show-memory" type="b">
  <default>true</default>
  <summary>Show memory in the monitor menu</summary>
</key>
<key name="monitor-show-disk" type="b">
  <default>true</default>
  <summary>Show disk usage in the monitor menu</summary>
</key>
<key name="monitor-show-network" type="b">
  <default>true</default>
  <summary>Show network rates in the monitor menu</summary>
</key>
<key name="monitor-show-temperature" type="b">
  <default>true</default>
  <summary>Show temperature in the monitor menu</summary>
</key>
```

- [ ] **Step 2: Implement the module**

Use `PanelMenu.Button`, `PopupMenu.PopupMenuItem`, `St.DrawingArea`, and `GLib`. Build a button with a label and a 64x18 sparkline. `Main.panel.addToStatusArea('homescreen-monitor', button, 0, 'right')`. Read files through `Gio.File.load_contents_async` and query disk through `query_filesystem_info_async('filesystem::size,filesystem::free')`. Keep a 30-sample CPU history and call `sparkline.queue_repaint()` after each sample. Schedule a repeating `context.scope.timeout(interval * 1000, ...)`. On disable, set `_active = false`, remove the source, destroy the button, and null state.

Menu rows update from the sample: CPU, memory, disk, network, temperature. Missing data renders `—`. Only the metric rows controlled by settings are visible.

- [ ] **Step 3: Add the preferences page**

Create `monitorPage.js` with a General group containing `monitor-enabled` and `monitor-interval`, and a Metrics group containing the four visibility switches. Add a description that the module reads `/proc` and `/sys` asynchronously and needs no root.

- [ ] **Step 4: Register and wire preferences**

In `extension.js`, import `MonitorModule` and add:

```javascript
this._registry.add('monitor', new MonitorModule(), 'monitor-enabled');
```

In `prefs.js`, import `buildMonitorPage` and call it after `buildTilingPage`.

- [ ] **Step 5: Run the gate**

Run: `make check`
Expected: PASS, ending `PROBE_OK`.

- [ ] **Step 6: Commit**

```bash
git add extension/src/modules/monitor/monitorModule.js extension/src/prefs/monitorPage.js extension/extension.js extension/prefs.js extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml
git commit -m "feat: add panel system monitor"
```

---

### Task 3: App-grid layout helpers

**Files:**
- Create: `extension/src/modules/appGrid/appGridLayout.js`
- Test: `tests/app-grid-layout.test.js`

**Interfaces:**
- Produces: `sortEntriesByName(entries)`, `pageEntries(entries, itemsPerPage)`, and `buildAlphabeticalPages(entries, itemsPerPage)`.

- [ ] **Step 1: Write the failing test**

```javascript
import {assert, assertEqual} from './helpers.js';
import {
    buildAlphabeticalPages,
    pageEntries,
    sortEntriesByName,
} from '../extension/src/modules/appGrid/appGridLayout.js';

const entries = [
    {id: 'z.desktop', name: 'Zebra'},
    {id: 'a.desktop', name: 'Alpha'},
    {id: 'm.desktop', name: 'Mail'},
];
assertEqual(sortEntriesByName(entries).map(entry => entry.id).join(','),
    'a.desktop,m.desktop,z.desktop', 'sorted ids');
assertEqual(pageEntries(entries, 2).length, 2, 'page count');
assertEqual(pageEntries(entries, 2)[1].length, 1, 'last page');
const pages = buildAlphabeticalPages(entries, 2);
assertEqual(pages[0][0].id, 'a.desktop', 'first app');
assertEqual(pages[1][0].id, 'z.desktop', 'last app');
assertEqual(buildAlphabeticalPages([], 2).length, 0, 'empty pages');

print('app grid layout tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/app-grid-layout.test.js`
Expected: FAIL with a missing module error.

- [ ] **Step 3: Implement the helpers**

Sort with `a.name.localeCompare(b.name)`. `pageEntries` throws on `itemsPerPage < 1`. `buildAlphabeticalPages` returns sorted pages of entry objects.

- [ ] **Step 4: Run the test to verify it passes**

Run: `GSETTINGS_SCHEMA_DIR="$PWD/extension/schemas" GSETTINGS_BACKEND=memory gjs -m tests/app-grid-layout.test.js`
Expected: PASS with `app grid layout tests passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/appGrid/appGridLayout.js tests/app-grid-layout.test.js
git commit -m "feat: add app grid layout helpers"
```

---

### Task 4: App-grid module, settings, and preferences

**Files:**
- Create: `extension/src/modules/appGrid/appGridModule.js`
- Create: `extension/src/prefs/appGridPage.js`
- Modify: `extension/extension.js`
- Modify: `extension/prefs.js`
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`

**Interfaces:**
- Consumes: `buildAlphabeticalPages`, `Main.overview._overview.controls.appDisplay`, and `OverviewControls.ControlsState`.
- Produces: `AppGridModule` registered as `app-grid` with `app-grid-enabled`.

- [ ] **Step 1: Add schema keys**

Add before `diagnostics-json`:

```xml
<key name="app-grid-enabled" type="b">
  <default>false</default>
  <summary>Enable app grid customization</summary>
</key>
<key name="app-grid-alphabetical" type="b">
  <default>true</default>
  <summary>Sort the app grid alphabetically</summary>
</key>
<key name="app-grid-rows" type="i">
  <default>4</default>
  <range min="2" max="8"/>
  <summary>App grid rows per page</summary>
</key>
<key name="app-grid-columns" type="i">
  <default>6</default>
  <range min="2" max="10"/>
  <summary>App grid columns per page</summary>
</key>
<key name="app-grid-icon-size" type="i">
  <default>64</default>
  <range min="32" max="96"/>
  <summary>App grid icon size in pixels</summary>
</key>
<key name="app-grid-show-labels" type="b">
  <default>true</default>
  <summary>Show app labels</summary>
</key>
<key name="app-grid-disable-remote-search" type="b">
  <default>false</default>
  <summary>Disable remote search providers</summary>
</key>
<key name="app-grid-launchpad" type="b">
  <default>false</default>
  <summary>Open the app grid by default from the overview toggle</summary>
</key>
```

- [ ] **Step 2: Implement the module**

Verified against GNOME Shell 50.1: `overviewControls.js` exports `ControlsState.APP_GRID = 2`, and `overviewControls.js` assigns `this._appDisplay = new AppDisplay.AppDisplay()` with an `appDisplay` getter. Access it as `Main.overview._overview.controls.appDisplay`.

On enable, save and restore:

- `appDisplay._savePages` (replace with a no-op while alphabetical mode is active)
- `global.settings.get_value('app-picker-layout')`
- `layoutManager.fixedIconSize`, `_fixedCols`, `_fixedRows`, `columns_per_page`, `rows_per_page`, `_pageWidth`, `_pageHeight`
- `Main.overview.show`
- `org.gnome.desktop.search-providers` `disable-external`

Apply the grid shape by setting the layout manager values and forcing `_pageWidth = -1; _pageHeight = -1; grid.queue_relayout()`. Build an alphabetical `aa{sv}` variant with each app id mapped to `new GLib.Variant('a{sv}', {position: GLib.Variant.new_int32(index)})`, set `app-picker-layout`, then call `appDisplay._redisplay()`.

For labels, iterate `appDisplay._grid.get_children()` and set `icon.icon?.label?.visible`. Reapply on `view-loaded`. For remote search, bind `app-grid-disable-remote-search` to `disable-external`. For Launchpad mode, replace `Main.overview.show` with a wrapper whose default state is `ControlsState.APP_GRID`.

Restore every saved value on disable, including the original `app-picker-layout` variant and the original `show` method, then call `_redisplay()` and `queue_relayout()`.

- [ ] **Step 3: Add the preferences page**

Create `appGridPage.js` with a General group (`app-grid-enabled`, `app-grid-alphabetical`, `app-grid-launchpad`), a Layout group (`app-grid-rows`, `app-grid-columns`, `app-grid-icon-size`, `app-grid-show-labels`), and a Search group (`app-grid-disable-remote-search`). Describe that Launchpad mode makes the overview toggle open the app grid first.

- [ ] **Step 4: Register and wire preferences**

In `extension.js`, import `AppGridModule` and add:

```javascript
this._registry.add('app-grid', new AppGridModule(), 'app-grid-enabled');
```

In `prefs.js`, import `buildAppGridPage` and call it after `buildMonitorPage`.

- [ ] **Step 5: Run the gate**

Run: `make check`
Expected: PASS, ending `PROBE_OK`.

- [ ] **Step 6: Commit**

```bash
git add extension/src/modules/appGrid/appGridModule.js extension/src/prefs/appGridPage.js extension/extension.js extension/prefs.js extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml
git commit -m "feat: add app grid customization"
```

---

### Task 5: Overview blur

**Files:**
- Modify: `extension/src/modules/visual/visualModule.js`
- Modify: `extension/src/prefs/visualPage.js`
- Modify: `extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml`

**Interfaces:**
- Consumes: `BlurController` and `Main.layoutManager._backgroundGroup`.
- Produces: `visual-blur-overview` setting and overview-only ACTOR blur.

- [ ] **Step 1: Add the schema key**

Add after `visual-blur-brightness`:

```xml
<key name="visual-blur-overview" type="b">
  <default>false</default>
  <summary>Blur the wallpaper behind the overview</summary>
</key>
```

- [ ] **Step 2: Extend the visual module**

Add `visual-blur-overview` to `SETTINGS_KEYS`. Save `Main.layoutManager._backgroundGroup` as `_backgroundGroup` with a comment that it is private in GNOME Shell 50.1 `layout.js`. Connect `Main.overview` `showing` and `hiding`. Apply a second named effect on `_backgroundGroup` with `Shell.BlurMode.ACTOR` only while the overview is visible and the setting is true. Remove it on hide, on setting change, and on disable.

- [ ] **Step 3: Add the preferences row**

Add a switch after the dock blur row: `visual-blur-overview`, title `Blur the overview wallpaper`, subtitle `Applies only while the overview is open.`

- [ ] **Step 4: Run the gate**

Run: `make check`
Expected: PASS, ending `PROBE_OK`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/modules/visual/visualModule.js extension/src/prefs/visualPage.js extension/schemas/org.gnome.shell.extensions.homescreen.gschema.xml
git commit -m "feat: blur the overview wallpaper"
```

---

### Task 6: Documentation and status

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `docs/superpowers/plans/2026-11-04-phase-5-monitor-app-grid.md`

- [ ] **Step 1: Update README**

Set the status to Phase 5, add monitor and app-grid feature bullets, change the preferences list to eight pages, add `src/modules/monitor/` and `src/modules/appGrid/`, link this plan, rename the limits section to `Phase 5 limits`, and record: monitor reads `/proc`/`/sys` only, disk is the root filesystem, temperature is thermal zone 0, app grid uses private Shell APIs off by default, Launchpad mode changes the overview toggle default, and overview blur costs GPU time.

- [ ] **Step 2: Update DESIGN**

Set the status to `Phase 5 implemented, live verification pending`. Expand the System monitor and App grid module paragraphs to match the implementation. Add a Phase 5 note that drag-to-reorder remains stock, the grid sorts alphabetically while enabled, and Launchpad mode only changes the default overview state.

- [ ] **Step 3: Add implementation corrections if needed**

Record any deviation discovered during execution, including exact API or signal differences.

- [ ] **Step 4: Run the final gate**

Run: `make check`
Expected: PASS, ending `PROBE_OK`.

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md docs/superpowers/plans/2026-11-04-phase-5-monitor-app-grid.md
git commit -m "docs: record phase 5 monitor and app grid status"
```

---

## Self-Review

- Spec coverage: monitor data, sampling, panel UI, preferences, app grid shape, alphabetical order, labels, remote search, Launchpad mode, overview blur, docs.
- Placeholders: none. Every task names files, APIs, commands, and expected output.
- Type consistency: `parseCpuStat` returns `{total, idle}`; `cpuUsage` consumes those objects; `buildAlphabeticalPages` returns arrays of `{id, name}` entries.
- Review focus coverage: read failures (Task 1 catches each read), disable cleanup (Tasks 2, 4, 5), layout restore (Task 4), Launchpad callers (Task 4), overview blur visibility (Task 5).

## Known deferrals

- App grid drag-to-reorder is not reimplemented; alphabetical mode suppresses layout persistence and restores the original layout on disable.
- Search provider toggles expose only the global remote-search switch, not per-provider rows.
- Monitor shows the root filesystem and thermal zone 0 only.
- Live Wayland verification remains manual and requires logout/login after install or update.
