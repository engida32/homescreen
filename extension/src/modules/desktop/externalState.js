export function snapshotBoolean(settings, key) {
    return settings.get_boolean(key);
}

export function snapshotString(settings, key) {
    return settings.get_string(key);
}

export function restoreBooleanIfUnchanged(settings, key, expected, value) {
    if (settings.get_boolean(key) === expected)
        settings.set_boolean(key, value);
}

export function restoreStringIfUnchanged(settings, key, expected, value) {
    if (settings.get_string(key) === expected)
        settings.set_string(key, value);
}
