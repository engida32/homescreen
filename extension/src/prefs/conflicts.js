import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Shell.Extensions';
const OBJECT_PATH = '/org/gnome/Shell/Extensions';
const INTERFACE = 'org.gnome.Shell.Extensions';

function call(method, params) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            BUS_NAME, OBJECT_PATH, INTERFACE, method, params, null,
            Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export async function extensionEnabled(uuid) {
    const reply = await call('ListExtensions', null);
    const [extensions] = reply.recursiveUnpack();
    return Boolean(extensions[uuid]?.enabled);
}

export function createConflictBanner(uuid, name) {
    const banner = new Adw.Banner({
        title: `${name} is enabled. Homescreen avoids taking over its feature.`,
        button_label: `Disable ${name}`,
        revealed: false,
    });
    banner.connect('button-clicked', () => {
        call('DisableExtension', new GLib.Variant('(s)', [uuid]))
            .then(() => {
                banner.title = `${name} is disabled. Re-enable Homescreen.`;
                banner.button_label = '';
            })
            .catch(error => {
                banner.title = `Could not disable ${name}: ${error.message}`;
            });
    });
    return banner;
}

export async function revealIfEnabled(banner, uuid) {
    try {
        banner.revealed = await extensionEnabled(uuid);
    } catch {
        banner.revealed = false;
    }
}
