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
