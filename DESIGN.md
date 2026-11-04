# Homescreen: Design and Roadmap

Status: Phase 5 implemented, live verification pending
Date: 2026-11-03
Target: Ubuntu 26.04, GNOME Shell 50.1, Wayland
Scope: personal use, one machine

## Summary

Homescreen is one modular GNOME Shell extension that replaces the overlapping panel, dock, lockscreen, blur, tiling, monitor, and app-grid extensions on this machine. It has one preferences window, one lifecycle, and one conflict policy.

The first runnable build is the clean desktop: a functional hide-top-bar panel, a Sonoma-style floating dock, and a desktop with no icons. The remaining modules follow in phases inside the same extension.

## Goals

- Keep the desktop and panel clean without hiding the fact that this is GNOME.
- Make the dock feel like a Mac dock, not a rectangle with icons.
- Replace six overlapping extensions with one codebase and one settings surface.
- Leave the stock Shell exactly as it was after the extension is disabled.
- Add visual polish without turning the Shell into a slow compositor demo.
- Stay safe on a single-user machine while still being aggressive about features.

## Success criteria

- Twenty enable and disable cycles leave no leaked signals, timeouts, actors, or keybindings.
- The panel hides and returns in under 200 ms, with no flicker.
- The dock launches, focuses, and minimizes apps without a layout jump.
- Lock and unlock twenty times without a stuck prompt or a broken lockscreen.
- Blur and rounded corners toggle cleanly and keep the overview responsive.
- Monitor hotplug does not leave stale panel or dock geometry.
- Reset restores the stock Shell without reinstalling the extension.

## Non-goals

- Clipboard history. Cliporium owns that.
- GDM or login-screen changes.
- Live or video wallpaper.
- Weather, media player, accounts, or AI widgets.
- Per-app blur rules in the first version.
- Multiple docks or a full macOS clone.
- EGO publication in the first version.

## Architecture

The extension is a small core plus feature modules. The core owns lifecycle, settings, resources, and conflict policy. Each module owns one feature and one preferences page.

```text
ubuntu homescreen/
  DESIGN.md
  README.md
  Makefile
  metadata.json
  extension.js
  prefs.js
  schemas/
  src/core/
  src/modules/panel/
  src/modules/dock/
  src/modules/desktop/
  src/modules/lockscreen/
  src/modules/visual/
  src/modules/tiling/
  src/modules/monitor/
  src/modules/appGrid/
  tests/
  scripts/
  docs/
```

Core services:

- Module registry and dependency order.
- Scoped signal, timeout, actor, and keybinding ownership.
- GSettings access and change tracking.
- Conflict detection with a known-extension table.
- Presets, export, import, and reset.
- Diagnostics: module status, resource counts, last error.
- Session guard: in `unlock-dialog`, disable every module except the lockscreen module.
- One stylesheet and one style class namespace.

Module contract:

```js
class Module {
    enable(context) {}
    disable() {}
}
```

The context exposes settings, signals, timeouts, keybindings, actors, logging, conflicts, and session mode. Modules enable in order and disable in reverse. A module that throws during enable is disabled and recorded, and the rest of the extension keeps running.

## Modules

### Core

Always on. Provides the preferences window, module registry, presets, conflict guard, diagnostics, and reset paths.

### Panel

Default mode: autohide. Modes are always visible, autohide, intellihide, and hidden. Reveal by top edge, pointer pressure, hot corner, or keyboard shortcut.

Settings: show in overview, show over fullscreen windows, hide delay, panel height, icon size, spacing, clock format, date style, activities button, workspace indicator, and system status area. Multi-monitor geometry is recomputed on monitor changes.

### Dock

Default: Sonoma floating dock, bottom-centered, autohide, intellihide, running dots. Position bottom, left, or right. Icon size, spacing, margin, corner radius, opacity, pinned apps, running apps, show-apps button, click to focus or minimize, middle-click new window, and Super+number launch.

The first release supports the primary monitor only. Per-monitor docks come later.

### Desktop

Clean desktop mode keeps DING off and desktop icons hidden. Focus mode hides the panel and dock, with an optional notification mute. A Show Desktop shortcut is included.

### Lockscreen

Sonoma-style Cupertino clock, date style, message, wallpaper, prompt animation, fade, unblank, and Esc-to-sleep. Disabled by default. Active only in the unlock-dialog session mode.

Conflicts with WACK, Blur my Shell lockscreen blur, Live Lock Screen, Lock screen background, and Unblank lock screen are blocked until resolved. Static wallpaper only. No GDM or login-screen changes.

### Visual

Blur for panel, dock, and overview wallpaper. Rounded panel and dock corners, opacity, shadows, and animation speed. Blur only while the surface is visible. Overview blur uses actor mode on the private background group and applies only while the overview is open. No per-app blur in the first version.

### Tiling

Keyboard snap layouts for halves, quarters, and full-width windows with configurable gaps, applied to the focused normal window on its current monitor and workspace. Drag-to-snap preview and snap assist are deferred because Mutter's tile preview and window-drag pipeline are private. Disabled by default because Ubuntu Tiling Assistant is currently enabled. The conflict guard blocks the module while Tiling Assistant is active.

### System monitor

CPU, memory, disk, network, and temperature when available. The panel shows a CPU sparkline and a details popover. Refresh is two seconds by default with a one-second floor. Sampling reads `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `/sys/class/thermal/thermal_zone0/temp`, and the root filesystem asynchronously. No root and no external binaries. Missing metrics render as an em dash.

### App grid and search

Alphabetical app grid with adjustable rows, columns, icon size, labels, a global remote-search toggle, and Launchpad mode. Alphabetical mode rewrites `app-picker-layout`, suppresses drag-to-reorder persistence while active, and restores the previous layout on disable. Launchpad mode only changes the default state of the overview toggle. The module uses private Shell APIs, is off by default, and is isolated so it can be disabled without affecting the rest of the extension.

## Mac-style dock specification

The dock should read as a Mac dock at a glance. The behavior matters more than the background image.

### Geometry

- Floating pill, bottom center.
- Margin from the bottom edge: 10 px default, 6 to 20 px range.
- Margin from the side edges: 16 px default.
- Height: icon size plus twice the padding plus the indicator row.
- Dynamic width based on icon count, capped at 80 percent of the monitor width.
- Corner radius: 24 px default, 16 to 32 px range.
- Icon size: 52 px default, 32 to 72 px range.
- Icon spacing: 8 px default, 4 to 16 px range.
- Inner padding: 10 px default.

### Material

- Translucent surface with a real blur behind it when the visual module supports it.
- Dark mode: dark neutral tint at 55 to 75 percent opacity.
- Light mode: warm white tint at 55 to 75 percent opacity.
- One-pixel inner border, white at 10 to 15 percent in dark mode, black at 8 to 12 percent in light mode.
- Soft drop shadow: 8 px y-offset, 24 px blur, 25 percent alpha.
- No hard black rectangle. If blur is unavailable, use a solid translucent fallback with the same radius and border.

### Icons and indicators

- Use the installed app icon at the requested size. Do not ship a custom icon pack.
- Running state uses a 4 px dot below the icon, in the system accent color. Inactive dots sit at 40 percent opacity.
- Active app gets a brighter dot and a subtle icon lift, not a permanent background tile.
- A thin separator separates pinned and running-only apps. The trash and show-apps buttons are optional and sit after the separator.
- Hover shows a small app-name label above the icon, faded in over 150 ms.

### Magnification

This is the signature Mac behavior. It needs to be smooth, not a toy.

- Scale each icon from its distance to the pointer.
- Peak scale: 1.35 default, 1.45 maximum.
- Falloff: 1.4 icon slots, so only the nearest three to five icons react.
- Keep every slot width fixed. Scale the icon around its bottom center and shift it upward. Do not relayout the dock during pointer motion.
- Animate scale with a short ease-out, 120 to 180 ms. No spring overshoot unless the user chooses it.
- Respect the reduced-motion setting. When reduced motion is on, disable magnification and launch bounce.
- Measure frame time with ten or more apps. If magnification drops frames, fall back to hover scale only.

### Motion

- Launch: one short bounce, 1.0 to 1.08 to 1.0 over 220 ms.
- Click: quick press scale to 0.96, then back to 1.0.
- Autohide: slide down 80 percent with a fade, 180 ms. Reveal in 140 ms.
- Intellihide: hide when the active window overlaps the dock area. Reveal on pointer at the bottom edge or when the overview opens.
- Minimize to dock: optional experimental scale-and-fade toward the app icon. A true genie effect needs deeper Shell changes, so it is not promised.
- Window previews on hover: phase two, after the basic dock is stable.

### Interaction

- Left click: focus the app. If focused, minimize all its windows.
- Middle click: open a new window.
- Right click: app menu.
- Super+number: launch or focus the pinned app in that slot.
- Drag to reorder pinned apps: phase two.
- Scroll on the dock: switch windows or workspaces, configurable.
- Badges: phase two. They need notification and app-state tracking that is easy to get wrong.

### Dock settings

Position, monitor, autohide, intellihide, reveal pressure, icon size, spacing, padding, margin, corner radius, opacity, blur toggle, magnification toggle, magnification strength, running indicators, show-apps button, trash, separator, click behavior, scroll behavior, animation speed, and reduced-motion override.

## Visual system

### Materials

Use a small set of surface styles: solid, translucent, and blurred glass. Keep the values in one stylesheet. Do not scatter colors and radii through module code.

Dark and light variants follow the system color scheme. Accent color follows the system accent. Running dots, focus rings, and selected states use the accent, not a hardcoded blue.

### Blur

- Panel blur when the panel is visible.
- Dock blur when the dock is visible.
- Overview blur behind the overview controls.
- App grid blur in Launchpad mode.
- Lockscreen blur is part of the lockscreen module and is optional.

Blur only runs while the surface is on screen. If the blur API is unavailable or unstable on GNOME 50.1, the fallback is a translucent surface with no blur. The design must look good without blur, not just with it.

### Rounded corners and shadows

- Panel: 12 to 16 px corners when floating, square when edge-attached.
- Dock: 24 px corners.
- App grid cards: 16 px corners.
- Windows: 12 px rounded corners are experimental and belong to the visual module. They need a shader or Shell patch and should be easy to turn off.
- Shadows stay soft and low-contrast. No glowing borders.

### Panel

When visible, the panel should feel like a glass menu bar:

- 32 to 36 px height.
- Transparent or blurred background.
- Smaller status icons and tighter spacing.
- Clock centered or right-aligned, configurable.
- Activities button optional.
- Workspace indicator as dots instead of text.
- Panel reveals at the top edge with the same pressure and delay settings as Hide Top Bar.

### Overview and app grid

- Dim and blur the wallpaper behind the overview.
- Reduce visual noise: hide window captions by default, keep workspace thumbnails optional.
- Launchpad mode: full-screen blurred app grid, large icons, search at the top, alphabetical order, no page arrows. This is optional and off by default.
- App grid settings: rows, columns, icon size, labels, and folder behavior.

### Window controls

Optional macOS-style control order: close, minimize, maximize. This writes the standard window button layout setting and depends on the GTK theme for the actual button artwork. It is a desktop tweak, not a Shell patch. It is off by default and clearly labeled.

### Motion

Three presets: Reduced, Smooth, and Snappy. Reduced disables magnification, bounce, and blur transitions. Smooth uses 180 to 240 ms. Snappy uses 100 to 140 ms. Respect the system animation setting at all times.

### Accessibility

- Never rely on color alone for running state. Use the dot and a shape change.
- Keep focus rings visible on dock icons and panel controls.
- Allow blur to be zero and opacity to be one.
- Respect high contrast, large text, and reduced motion.
- Test keyboard-only launch and focus paths.

## Preferences and presets

One Adwaita preferences window with a sidebar: General, Panel, Dock, Desktop, Lockscreen, Visual, Tiling, Monitor, App Grid, Presets, Diagnostics, About.

Each module page starts with an enable switch. Disabled modules gray out their controls. A conflict banner sits at the top and offers a one-click "disable the other extension" action. The extension never silently disables another extension.

Presets:

- Clean: panel autohide, dock autohide, no desktop icons, no heavy blur.
- Sonoma: floating dock with magnification, glass panel, blur, rounded corners, Cupertino lockscreen, Launchpad grid.
- Power: panel visible, system monitor, tiling, workspace indicator, dock visible.
- Presentation: panel and dock hidden, notifications muted, Caffeine behavior on.
- Minimal: panel visible, dock off, no effects, no monitor.

Users can duplicate a preset and save their own. Export and import use a readable JSON file. Reset can target one module or the whole extension.

## Safety and conflict policy

Known conflicts are detected by extension UUID. The table is verified at implementation time. Initial entries:

- Hide Top Bar
- Dash to Dock
- Ubuntu Dock
- Blur my Shell
- Tiling Assistant
- Tiling Shell
- gTile
- PaperWM
- WACK Sonoma Lockscreen
- Clipboard Indicator
- Just Perfection
- TopHat
- Vitals

Policy: detect, explain, and offer a one-click disable action. Do not take over another extension's feature silently. A module that conflicts stays off until the user resolves it.

Every module must use the scoped resource registries. No synchronous file I/O or synchronous D-Bus on the Shell main loop. No private API without a comment naming the Shell version it was verified against. The lockscreen module patches only while locked and restores the original methods on disable. The diagnostics page reports signal and timeout counts so leaks are visible.

## Testing

Three layers:

- GJS unit tests for settings, geometry math, magnification math, snap math, conflict detection, and preset serialization.
- Headless actor tests for panel and dock layout, using stubs for Shell actors.
- Manual matrix on GNOME 50.1: enable and disable cycles, lock and unlock, multi-monitor hotplug, fullscreen, overview, workspace switching, app launch, drag and drop, and preferences changes.

`make test` and `make check` gate each phase. The manual matrix is required before a phase is called done.

Performance checks:

- Idle CPU stays near zero when the panel and dock are hidden.
- Monitor polling does not run faster than one second.
- Blur runs only on visible surfaces.
- Magnification uses transforms, not relayout.
- Twenty enable and disable cycles show no resource growth.

## Phases

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | Core, settings, prefs shell, tests, conflict guard | Extension enables and disables cleanly with no modules |
| 1 | Panel, dock v1, desktop, focus mode | Clean desktop, reliable panel reveal, usable dock, magnification spike passed or explicitly deferred |
| 2 | Lockscreen, dock v2 | Lock and unlock 20 times, only lockscreen module active in unlock-dialog, previews and badges evaluated |
| 3 | Visual | Blur, rounded corners, panel glass, Launchpad mode toggle cleanly and keep the overview responsive |
| 4 | Tiling | Snap layouts and gaps work, Tiling Assistant conflict resolved |
| 5 | Monitor, app grid | Stable two-second monitor updates, alphabetical grid, no main-loop stalls |
| 6 | Presets, diagnostics, docs, packaging | Full reset, export and import, install and uninstall verified |

Phase 1 is the first usable milestone. The other modules are not allowed to delay it.

Phase 3 implements panel and dock blur plus panel glass. Overview blur and Launchpad mode are deferred to Phase 5, where the app grid and overview are restructured. Motion presets remain deferred until they can be added without a second animation system.

Phase 4 implements keyboard tiling for halves, quarters, and the full work area with configurable gaps. Drag-to-snap preview and snap assist are deferred because Mutter's tile preview and window-drag pipeline are private.

Phase 5 implements the system monitor and app grid customization. The grid sorts alphabetically while enabled, drag-to-reorder remains stock, and Launchpad mode only changes the default overview state. Overview blur is opt-in and runs only while the overview is open.

## Acceptance criteria

- A clean logout and login shows the dock and panel in the expected state.
- The panel reveals from the top edge, hides after the configured delay, and does not flicker.
- The dock launches, focuses, and minimizes apps, and autohide works with maximized windows.
- Magnification stays smooth with at least ten apps, or the fallback is active and documented.
- The desktop has no icons, and focus mode hides the panel and dock.
- The lockscreen module can be disabled before login and does not leave patched methods behind.
- Blur can be turned off completely, and the Shell still looks intentional.
- Keyboard tiling snaps the focused window to halves and quarters with the configured gap, and leaves stock behavior alone when disabled.
- Reset restores stock panel, dock, and desktop behavior.
- No module leaves a source or signal after disable.

## Open decisions

- Launchpad mode: build it, or keep the stock GNOME overview? Recommendation: build it as an optional module, off by default.
- macOS window controls: include the button-order toggle, or leave window chrome alone? Recommendation: include it as an off-by-default desktop tweak.
- Dock on all monitors: primary only in phase 1, per-monitor later.
- Blur quality versus battery: balanced default, with an explicit Performance preset.
- WhiteSur theme integration: keep Yaru first, document WhiteSur compatibility later.
- User Themes: keep it enabled for shell theme flexibility, but test that the extension stylesheet survives theme changes.

## Assumptions to verify

These are implementation spikes, not settled facts:

- The GNOME 50.1 blur effect API is usable for panel, dock, and overview surfaces. If not, ship the translucent fallback.
- A normal extension with both user and unlock-dialog session modes can run the lockscreen module without enabling the other modules there.
- App icon actors and window tracking can be built from the installed Shell APIs without private internals beyond what the dock already needs.
- The extension stylesheet coexists with User Themes without fighting it.
- Wayland allows the scale-and-fade minimize approximation without a Shell patch.

## Customization ideas

- Dock: floating or edge-attached, magnification curve, icon size, running dot style, separator, trash, show-apps button, scroll behavior, per-app pinning.
- Panel: glass, solid, or hidden, centered clock, workspace dots, system status density, panel height.
- Visual: accent-aware highlights, wallpaper tint, blur strength, corner radius, shadow depth, motion presets.
- Lockscreen: Cupertino clock, date format, message, wallpaper, prompt animation, unblank behavior.
- Desktop: focus mode, show desktop, notification mute, icon policy.
- Tiling: layout presets, gaps, keyboard-first snapping.
- Monitor: CPU, memory, disk, network, temperature, sparkline style.
- App grid: Launchpad mode, alphabetical order, grid density, icon labels.
- Presets: Clean, Sonoma, Power, Presentation, Minimal, plus user presets.
