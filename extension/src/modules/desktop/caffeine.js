import GLib from 'gi://GLib';

export const CAFFEINE_FLAGS = 12;

export class CaffeineInhibitor {
    constructor(call, {appId, reason}) {
        this._call = call;
        this._appId = appId;
        this._reason = reason;
        this._cookie = 0;
        this._generation = 0;
    }

    get cookie() {
        return this._cookie;
    }

    async inhibit() {
        if (this._cookie)
            return this._cookie;

        const generation = ++this._generation;
        const cookie = await this._call('Inhibit',
            new GLib.Variant('(susu)', [
                this._appId, 0, this._reason, CAFFEINE_FLAGS,
            ]));

        if (generation !== this._generation) {
            await this._call('Uninhibit', new GLib.Variant('(u)', [cookie]));
            return 0;
        }

        this._cookie = cookie;
        return cookie;
    }

    async release() {
        this._generation++;
        if (!this._cookie)
            return;
        const cookie = this._cookie;
        this._cookie = 0;
        await this._call('Uninhibit', new GLib.Variant('(u)', [cookie]));
    }
}
