import {conflictDetail, findActiveConflicts} from './conflicts.js';

export class ModuleRegistry {
    constructor(context) {
        this._context = context;
        this._entries = [];
        this._enabled = [];
    }

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

    reload() {
        this.disableAll();
        this.enableAll();
    }

    sync() {
        const mode = this._context.currentMode;

        for (const {entry, scope} of [...this._enabled]) {
            if (!entry.sessionModes.includes(mode)) {
                this._disable(entry, scope);
                this._enabled = this._enabled.filter(item => item.entry !== entry);
                continue;
            }

            const conflicts = this._conflicts(entry);
            if (conflicts.length > 0) {
                this._disable(entry, scope);
                this._enabled = this._enabled.filter(item => item.entry !== entry);
                this._context.diagnostics.setModule(entry.id, 'blocked', conflictDetail(conflicts));
            }
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

        const conflicts = this._conflicts(entry);
        if (conflicts.length > 0) {
            this._context.diagnostics.setModule(entry.id, 'blocked', conflictDetail(conflicts));
            this._context.logger.info(`${entry.id} blocked by ${conflictDetail(conflicts)}`);
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

    _conflicts(entry) {
        if (!this._context.extensionManager)
            return [];
        return findActiveConflicts(entry.id, uuid =>
            this._context.extensionManager.lookup(uuid));
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

    status(id) {
        return this._context.snapshot().modules[id]?.status ?? 'unknown';
    }
}
