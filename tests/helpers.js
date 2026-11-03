import GLib from 'gi://GLib';

export function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new Error(message);
}

export function assertEqual(actual, expected, message = '') {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

export function waitFor(promise) {
    const loop = GLib.MainLoop.new(null, false);
    let value;
    let error;
    promise.then(result => {
        value = result;
        loop.quit();
    }, failure => {
        error = failure;
        loop.quit();
    });
    loop.run();
    if (error)
        throw error;
    return value;
}

export function waitForTimeout(milliseconds) {
    return waitFor(new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    }));
}
