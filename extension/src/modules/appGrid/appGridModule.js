import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

import {
    applyGridShape,
    buildAlphabeticalPages,
    buildLayoutVariant,
    createLaunchpadToggle,
    restoreGridShape,
} from './appGridLayout.js';

// Private GNOME Shell 50.1 APIs used here, verified against the installed
// shell sources:
// - overview.js / overviewControls.js: Main.overview._overview.controls.appDisplay,
//   Main.overview.toggle, Main.overview.show, ControlsState.APP_GRID.
// - appDisplay.js: _items, _savePages, _redisplay, app-picker-layout.
// - iconGrid.js: _grid, layoutManager, fixedIconSize, _fixedCols, _fixedRows,
//   columns_per_page, rows_per_page, _pageWidth, _pageHeight.
// - layout.js: Main.layoutManager._backgroundGroup (visual module).
const APP_DISPLAY_RETRIES = 20;
const APP_DISPLAY_RETRY_MS = 250;
const LAYOUT_DEBOUNCE_MS = 100;

export class AppGridModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._context = null;
        this._appDisplay = null;
        this._active = false;
        this._retries = 0;
        this._layoutSource = 0;
        this._originalGrid = null;
        this._originalSavePages = null;
        this._originalLayout = null;
        this._preAlphabeticalLayout = null;
        this._alphabeticalApplied = false;
        this._savePagesPatched = false;
        this._searchSettings = null;
        this._originalDisableExternal = null;
        this._originalToggle = null;
        this._patchedToggle = null;
        this._lastAlphabeticalSignature = null;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._context = context;
        this._active = true;
        this._retries = 0;
        this._initAppDisplay();
    }

    _initAppDisplay() {
        if (!this._active)
            return;

        const appDisplay = Main.overview?._overview?.controls?.appDisplay ?? null;
        if (!appDisplay) {
            if (this._retries++ < APP_DISPLAY_RETRIES) {
                this._scope.timeout(APP_DISPLAY_RETRY_MS, () => {
                    this._initAppDisplay();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._context.logger.error('app grid unavailable');
            }
            return;
        }

        this._appDisplay = appDisplay;
        const layout = appDisplay._grid.layoutManager;
        this._originalGrid = {
            fixedIconSize: layout.fixedIconSize,
            fixedCols: layout._fixedCols,
            fixedRows: layout._fixedRows,
            columnsPerPage: layout.columns_per_page,
            rowsPerPage: layout.rows_per_page,
            pageWidth: layout._pageWidth,
            pageHeight: layout._pageHeight,
        };
        this._originalSavePages = appDisplay._savePages;
        this._originalLayout = global.settings.get_value('app-picker-layout');
        this._preAlphabeticalLayout = this._originalLayout;

        try {
            this._searchSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.search-providers',
            });
            this._originalDisableExternal =
                this._searchSettings.get_boolean('disable-external');
        } catch (error) {
            this._context.logger.error('search provider settings unavailable', error);
            this._searchSettings = null;
            this._originalDisableExternal = null;
        }

        this._scope.signal(appDisplay, 'view-loaded', () => {
            if (!this._active)
                return;
            this._applyLabels();
            this._queueAlphabetical();
        });
        this._scope.signal(Shell.AppSystem.get_default(), 'installed-changed',
            () => this._queueAlphabetical());

        for (const key of [
            'app-grid-alphabetical',
            'app-grid-rows',
            'app-grid-columns',
            'app-grid-icon-size',
            'app-grid-show-labels',
            'app-grid-disable-remote-search',
            'app-grid-launchpad',
        ]) {
            this._scope.signal(this._settings, `changed::${key}`,
                () => this._syncSetting(key));
        }

        try {
            this._applyGridShape();
            this._syncAlphabetical();
            this._applyLabels();
            this._syncRemoteSearch();
            this._syncLaunchpad();
        } catch (error) {
            this._context.logger.error('app grid initialization failed', error);
            this._rollbackInitialization();
        }
    }

    _rollbackInitialization() {
        try {
            this._restoreStock();
        } catch (error) {
            this._context?.logger.error('app grid rollback failed', error);
        }

        this._appDisplay = null;
        this._originalGrid = null;
        this._originalSavePages = null;
        this._originalLayout = null;
        this._preAlphabeticalLayout = null;
        this._alphabeticalApplied = false;
        this._savePagesPatched = false;
        this._searchSettings = null;
        this._originalDisableExternal = null;
        this._originalToggle = null;
        this._patchedToggle = null;
        this._lastAlphabeticalSignature = null;
    }

    _syncSetting(key) {
        if (!this._appDisplay)
            return;

        switch (key) {
        case 'app-grid-alphabetical':
            this._syncAlphabetical();
            break;
        case 'app-grid-rows':
        case 'app-grid-columns':
        case 'app-grid-icon-size':
            this._applyGridShape();
            this._applyAlphabetical();
            break;
        case 'app-grid-show-labels':
            this._applyLabels();
            break;
        case 'app-grid-disable-remote-search':
            this._syncRemoteSearch();
            break;
        case 'app-grid-launchpad':
            this._syncLaunchpad();
            break;
        }
    }

    _applyGridShape() {
        const layout = this._appDisplay._grid.layoutManager;
        applyGridShape(layout, {
            rows: this._settings.get_int('app-grid-rows'),
            columns: this._settings.get_int('app-grid-columns'),
            iconSize: this._settings.get_int('app-grid-icon-size'),
        });
        this._appDisplay._grid.queue_relayout();
    }

    _syncAlphabetical() {
        if (this._settings.get_boolean('app-grid-alphabetical')) {
            this._patchSavePages(true);
            this._applyAlphabetical();
        } else {
            this._restoreLayout();
            this._patchSavePages(false);
        }
    }

    _patchSavePages(patched) {
        if (!this._appDisplay || !this._originalSavePages)
            return;
        if (patched && !this._savePagesPatched) {
            this._appDisplay._savePages = () => {};
            this._savePagesPatched = true;
        } else if (!patched && this._savePagesPatched) {
            this._appDisplay._savePages = this._originalSavePages;
            this._savePagesPatched = false;
        }
    }

    _applyAlphabetical() {
        if (!this._appDisplay ||
            !this._settings.get_boolean('app-grid-alphabetical'))
            return;

        if (!this._alphabeticalApplied)
            this._preAlphabeticalLayout = global.settings.get_value('app-picker-layout');

        const entries = [...this._appDisplay._items.values()]
            .filter(icon => icon.visible && icon.id && icon.name)
            .map(icon => ({id: icon.id, name: icon.name}));
        const rows = this._settings.get_int('app-grid-rows');
        const columns = this._settings.get_int('app-grid-columns');
        const pages = buildAlphabeticalPages(entries, rows * columns);
        const signature = `${rows}x${columns}:${entries.map(entry => entry.id).join('\n')}`;

        if (this._alphabeticalApplied &&
            signature === this._lastAlphabeticalSignature) {
            this._applyLabels();
            return;
        }

        global.settings.set_value('app-picker-layout',
            buildLayoutVariant(pages));
        this._alphabeticalApplied = true;
        this._lastAlphabeticalSignature = signature;

        // GNOME Shell 50.1 appDisplay.js: _redisplay reads app-picker-layout
        // through PageManager and moves icons into the saved positions.
        this._appDisplay._redisplay();
        this._appDisplay._grid.queue_relayout();
        this._applyLabels();
    }

    _restoreLayout() {
        if (!this._appDisplay || !this._alphabeticalApplied)
            return;

        global.settings.set_value('app-picker-layout',
            this._preAlphabeticalLayout ?? this._originalLayout);
        this._alphabeticalApplied = false;
        this._lastAlphabeticalSignature = null;
        this._appDisplay._redisplay();
        this._appDisplay._grid.queue_relayout();
    }

    _queueAlphabetical() {
        if (!this._active || !this._appDisplay ||
            !this._settings.get_boolean('app-grid-alphabetical'))
            return;

        if (this._layoutSource)
            this._scope.removeSource(this._layoutSource);
        this._layoutSource = this._scope.timeout(LAYOUT_DEBOUNCE_MS, () => {
            this._layoutSource = 0;
            this._applyAlphabetical();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyLabels() {
        if (!this._appDisplay)
            return;
        const visible = this._settings.get_boolean('app-grid-show-labels');
        for (const icon of this._appDisplay._items.values()) {
            if (icon.icon?.label)
                icon.icon.label.visible = visible;
        }
    }

    _syncRemoteSearch() {
        if (!this._searchSettings)
            return;
        if (this._settings.get_boolean('app-grid-disable-remote-search'))
            this._searchSettings.set_boolean('disable-external', true);
        else if (this._originalDisableExternal === false)
            this._searchSettings.set_boolean('disable-external', false);
    }

    _syncLaunchpad() {
        if (!Main.overview)
            return;

        if (this._settings.get_boolean('app-grid-launchpad')) {
            if (this._patchedToggle)
                return;
            this._originalToggle = Main.overview.toggle;
            this._patchedToggle = createLaunchpadToggle(
                Main.overview,
                this._originalToggle,
                OverviewControls.ControlsState.APP_GRID);
            Main.overview.toggle = this._patchedToggle;
        } else {
            this._restoreLaunchpad();
        }
    }

    _restoreLaunchpad() {
        if (!this._patchedToggle)
            return;
        if (Main.overview?.toggle === this._patchedToggle)
            Main.overview.toggle = this._originalToggle;
        this._patchedToggle = null;
        this._originalToggle = null;
    }

    _restoreSearch() {
        if (!this._searchSettings || this._originalDisableExternal === null)
            return;
        try {
            this._searchSettings.set_boolean('disable-external',
                this._originalDisableExternal);
        } catch {
            // The schema may be unavailable during shell shutdown.
        }
    }

    _restoreStock() {
        if (this._appDisplay) {
            this._restoreLayout();
            this._patchSavePages(false);

            if (this._originalGrid) {
                restoreGridShape(this._appDisplay._grid.layoutManager,
                    this._originalGrid);
                this._appDisplay._grid.queue_relayout();
            }

            for (const icon of this._appDisplay._items.values()) {
                if (icon.icon?.label)
                    icon.icon.label.visible = true;
            }
        }

        this._restoreSearch();
        this._restoreLaunchpad();
    }

    disable() {
        this._active = false;
        if (this._layoutSource && this._scope)
            this._scope.removeSource(this._layoutSource);
        this._layoutSource = 0;

        this._restoreStock();

        this._appDisplay = null;
        this._originalGrid = null;
        this._originalSavePages = null;
        this._originalLayout = null;
        this._preAlphabeticalLayout = null;
        this._alphabeticalApplied = false;
        this._lastAlphabeticalSignature = null;
        this._savePagesPatched = false;
        this._searchSettings = null;
        this._originalDisableExternal = null;
        this._originalToggle = null;
        this._patchedToggle = null;
        this._context = null;
        this._settings = null;
        this._scope = null;
    }
}
