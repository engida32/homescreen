import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

import {buildAlphabeticalPages} from './appGridLayout.js';

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
        this._originalShow = null;
        this._patchedShow = null;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._context = context;
        this._active = true;
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
            if (this._active)
                this._applyLabels();
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

        this._applyGridShape();
        this._syncAlphabetical();
        this._applyLabels();
        this._syncRemoteSearch();
        this._syncLaunchpad();
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
        layout.fixedIconSize = this._settings.get_int('app-grid-icon-size');
        layout._fixedCols = this._settings.get_int('app-grid-columns');
        layout._fixedRows = this._settings.get_int('app-grid-rows');
        layout._pageWidth = -1;
        layout._pageHeight = -1;
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
        const itemsPerPage = this._settings.get_int('app-grid-rows') *
            this._settings.get_int('app-grid-columns');
        const pages = buildAlphabeticalPages(entries, itemsPerPage);
        const layout = pages.map(page => {
            const data = {};
            page.forEach((entry, index) => {
                data[entry.id] = {position: GLib.Variant.new_int32(index)};
            });
            return data;
        });

        global.settings.set_value('app-picker-layout',
            new GLib.Variant('aa{sv}', layout));
        this._alphabeticalApplied = true;

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
        this._searchSettings.set_boolean('disable-external',
            this._settings.get_boolean('app-grid-disable-remote-search'));
    }

    _syncLaunchpad() {
        if (!Main.overview)
            return;

        if (this._settings.get_boolean('app-grid-launchpad')) {
            if (this._patchedShow)
                return;
            this._originalShow = Main.overview.show;
            this._patchedShow = (state = OverviewControls.ControlsState.APP_GRID) =>
                this._originalShow.call(Main.overview, state);
            Main.overview.show = this._patchedShow;
        } else if (this._patchedShow) {
            if (Main.overview.show === this._patchedShow)
                Main.overview.show = this._originalShow;
            this._patchedShow = null;
            this._originalShow = null;
        }
    }

    disable() {
        this._active = false;
        this._layoutSource = 0;

        if (this._appDisplay) {
            this._restoreLayout();
            this._patchSavePages(false);

            const layout = this._appDisplay._grid.layoutManager;
            if (this._originalGrid) {
                layout.fixedIconSize = this._originalGrid.fixedIconSize;
                layout._fixedCols = this._originalGrid.fixedCols;
                layout._fixedRows = this._originalGrid.fixedRows;
                layout.columns_per_page = this._originalGrid.columnsPerPage;
                layout.rows_per_page = this._originalGrid.rowsPerPage;
                layout._pageWidth = this._originalGrid.pageWidth;
                layout._pageHeight = this._originalGrid.pageHeight;
                this._appDisplay._grid.queue_relayout();
            }

            for (const icon of this._appDisplay._items.values()) {
                if (icon.icon?.label)
                    icon.icon.label.visible = true;
            }
        }

        if (this._searchSettings && this._originalDisableExternal !== null) {
            try {
                this._searchSettings.set_boolean('disable-external',
                    this._originalDisableExternal);
            } catch {
                // The schema may be unavailable during shell shutdown.
            }
        }

        if (this._patchedShow) {
            if (Main.overview?.show === this._patchedShow)
                Main.overview.show = this._originalShow;
            this._patchedShow = null;
            this._originalShow = null;
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
        this._context = null;
        this._settings = null;
        this._scope = null;
    }
}
