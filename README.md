# Homescreen

A personal GNOME Shell extension that combines a hideable top panel, a floating dock, and a clean desktop in one codebase and one preferences window.

Status: Phase 5 is implemented and tested headlessly. It is not published on extensions.gnome.org yet, and the live Wayland matrix is still pending.

## Features

- Hide and reveal the top panel at the screen edge, with intellihide against window overlap.
- Float a dock on the bottom, left, or right edge with pinned and running apps, magnification, autohide, intellihide, and edge reveal.
- Hide DING desktop icons and restore the exact previous values when disabled.
- Focus mode hides the panel and dock together.
- Show Desktop minimizes only the windows it owns and restores them.
- Custom lockscreen clock, date, message, and static wallpaper, active only while locked.
- Opt-in native blur behind the panel, dock, and overview wallpaper, with configurable radius, brightness, and panel glass opacity.
- Opt-in keyboard tiling for halves, quarters, and the full work area, with configurable gaps.
- A panel system monitor for CPU, memory, disk, network, and thermal zone 0 temperature, with a sparkline and details popover.
- An optional alphabetical app grid with adjustable rows, columns, icon size, labels, a remote-search toggle, and Launchpad mode.
- Detect Ubuntu Dock and Tiling Assistant, explain the conflict, and offer one-click disable instead of silently fighting them.
- Panel, dock, visual, tiling, monitor, app grid, desktop, and lockscreen preferences in a native GTK4 preferences window.
- Disable restores the stock panel struts and background, destroys the dock actor, restores DING values, releases the Show Desktop keybinding, resets focus mode, restores the app grid layout and overview behavior, and destroys the monitor indicator.

## Requirements

- Ubuntu 26.04 with GNOME Shell 50.1 on Wayland.
- The extension declares `shell-version: ["50"]` and opts into the `user` and `unlock-dialog` session modes.
- X11 is not supported.

## Install from source

```bash
git clone https://github.com/engida32/homescreen.git
cd homescreen
make install
```

Log out and back in on Wayland after installing or updating.

To remove it:

```bash
make uninstall
```

## Preferences

Open the extension preferences from GNOME Extensions or Extension Manager. The window has eight pages:

- Panel: enable, hide mode, intellihide, and related timing.
- Dock: enable, position, autohide, intellihide, size, spacing, padding, margin, radius, opacity, magnification, strength, and hide delay.
- Visual: enable, panel blur, dock blur, overview blur, radius, and brightness.
- Tiling: enable, gap, Tiling Assistant conflict, and display-only shortcut rows.
- Monitor: enable, refresh interval, and visible metrics.
- App Grid: enable, alphabetical sort, Launchpad mode, rows, columns, icon size, labels, and remote search.
- Desktop: enable, hide icons, focus mode, and the Show Desktop shortcut.
- Lockscreen: enable, clock and date formats, message, and wallpaper URI.

Enable switches apply after the extension is re-enabled.

## Development

Run the unit tests and package the extension:

```bash
make test
make pack
```

Run the full gate. It validates metadata, every GJS suite, JavaScript syntax, every relative import, the packaged zip, and an isolated install and removal:

```bash
make check
```

The live cycle test needs a logged-in GNOME 50 Wayland session:

```bash
./scripts/cycle-extension.sh 20
```

Watch the Shell log in a second terminal:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

The extension targets GNOME Shell 50, so a current CI runner verifies the headless checks only. Live panel, dock, DING, focus-mode, preferences, and disable-cleanup behavior must be checked on the target session.

## Project layout

```text
extension/              packaged extension source
  extension.js          Shell entry point
  prefs.js              GTK4 preferences entry point
  metadata.json         UUID, shell version, settings schema
  schemas/              GSettings schema
  src/core/             context, registry, logger, scoped ownership
  src/modules/panel/    panel geometry and panel module
  src/modules/dock/     dock layout, visibility, icons, module
  src/modules/desktop/  DING, focus mode, Show Desktop
  src/modules/lockscreen/  unlock-dialog clock, date, message, wallpaper
  src/modules/visual/      blur controller and panel/dock/overview blur module
  src/modules/tiling/      snap geometry and keyboard tiling module
  src/modules/monitor/     async /proc and /sys sampling plus panel indicator
  src/modules/appGrid/     alphabetical layout, grid shape, labels, search, Launchpad
  src/prefs/            preference pages and helpers
scripts/                maintenance and live cycle scripts
tests/                  headless GJS tests and install probe
docs/                   design and implementation plan
```

The Phase 5 implementation plan is in `docs/superpowers/plans/2026-11-04-phase-5-monitor-app-grid.md`; the Phase 4 plan is in `docs/superpowers/plans/2026-11-04-phase-4-tiling.md`; the Phase 3 plan is in `docs/superpowers/plans/2026-11-04-phase-3-visual.md`; the Phase 2 plan is in `docs/superpowers/plans/2026-11-04-phase-2-lockscreen-dock-v2.md`; the Phase 1 plan is in `docs/plans/2026-11-03-phase-1-core-panel-dock-desktop.md`; the design and roadmap are in `DESIGN.md`.

## Phase 5 limits

- The monitor reads `/proc` and `/sys` only. Disk is the root filesystem and temperature is thermal zone 0.
- App grid customization uses private GNOME Shell APIs. It is off by default and can be disabled without affecting the rest of the extension.
- Alphabetical mode suppresses drag-to-reorder persistence. Disabling it restores the saved layout from before it was enabled.
- Launchpad mode only changes the default state of the overview toggle. It does not replace the overview.
- Panel and dock blur use `Shell.BlurEffect` in background mode. All blur is off by default because it costs GPU time.
- Overview blur uses `Shell.BlurEffect` in actor mode and costs GPU time while the overview is open.
- Dock position supports bottom, left, and right; window previews and badges are not implemented.
- The lockscreen uses the current Shell unlock dialog; GDM is untouched.
- Lockscreen fade, unblank, and Esc-to-sleep remain manual checks.
- The dock reveal is a two-pixel strip rather than the final slide and fade.
- Tiling uses keyboard layouts only. Drag-to-snap previews and snap assist are deferred because Mutter's tile preview and window-drag pipeline are private.
- The gap applies to this module's layouts. Stock GNOME tiling still uses zero gaps.
- Tiling is off by default and is blocked while Tiling Assistant is enabled.
- The preference shortcut rows are display-only.
- Live Wayland verification is still manual.
- On Wayland, a freshly installed or updated extension only loads after logout and login; enabling it in the running session reports that it does not exist.

## License

GPL-3.0. See `LICENSE`.
