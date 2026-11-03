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
