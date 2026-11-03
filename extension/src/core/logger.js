export class Logger {
    constructor(limit = 100) {
        this._limit = limit;
        this._entries = [];
    }

    info(message) {
        this._push('info', message);
    }

    error(message, error) {
        const detail = error?.message ?? String(error);
        this._push('error', `${message}: ${detail}`);
        if (error?.stack)
            console.error(error.stack);
    }

    _push(level, message) {
        this._entries.push({time: Date.now(), level, message});
        if (this._entries.length > this._limit)
            this._entries.shift();
    }

    entries() {
        return [...this._entries];
    }
}
