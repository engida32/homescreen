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
