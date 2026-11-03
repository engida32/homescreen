import GLib from 'gi://GLib';

export class SignalRegistry {
    constructor() {
        this._entries = new Map();
        this._nextId = 1;
    }

    connect(target, signal, callback) {
        const targetId = target.connect(signal, callback);
        const id = this._nextId++;
        this._entries.set(id, {target, targetId});
        return id;
    }

    disconnect(id) {
        const entry = this._entries.get(id);
        if (!entry)
            return;
        this._entries.delete(id);
        try {
            entry.target.disconnect(entry.targetId);
        } catch {
            // The actor may already be destroyed.
        }
    }

    disconnectAll() {
        for (const {target, targetId} of this._entries.values()) {
            try {
                target.disconnect(targetId);
            } catch {
                // The actor may already be destroyed.
            }
        }
        this._entries.clear();
    }

    get size() {
        return this._entries.size;
    }
}

export class SourceRegistry {
    constructor() {
        this._ids = new Set();
    }

    timeoutAdd(priority, interval, callback) {
        let id = 0;
        id = GLib.timeout_add(priority, interval, () => {
            const result = callback();
            if (result === GLib.SOURCE_REMOVE)
                this._ids.delete(id);
            return result;
        });
        this._ids.add(id);
        return id;
    }

    idleAdd(priority, callback) {
        let id = 0;
        id = GLib.idle_add(priority, () => {
            const result = callback();
            if (result === GLib.SOURCE_REMOVE)
                this._ids.delete(id);
            return result;
        });
        this._ids.add(id);
        return id;
    }

    remove(id) {
        if (!this._ids.delete(id))
            return;
        try {
            GLib.source_remove(id);
        } catch {
            // The source already completed.
        }
    }

    removeAll() {
        for (const id of this._ids) {
            try {
                GLib.source_remove(id);
            } catch {
                // The source already completed.
            }
        }
        this._ids.clear();
    }

    get size() {
        return this._ids.size;
    }
}

export class ModuleScope {
    constructor(name) {
        this.name = name;
        this._signals = new SignalRegistry();
        this._sources = new SourceRegistry();
    }

    signal(target, signal, callback) {
        return this._signals.connect(target, signal, callback);
    }

    timeout(interval, callback, priority = GLib.PRIORITY_DEFAULT) {
        return this._sources.timeoutAdd(priority, interval, callback);
    }

    idle(callback, priority = GLib.PRIORITY_DEFAULT) {
        return this._sources.idleAdd(priority, callback);
    }

    destroy() {
        this._signals.disconnectAll();
        this._sources.removeAll();
    }

    get signalCount() {
        return this._signals.size;
    }

    get sourceCount() {
        return this._sources.size;
    }
}
