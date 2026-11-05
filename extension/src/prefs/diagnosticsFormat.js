function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectEntries(value) {
    if (!isPlainObject(value))
        return {};
    const entries = {};
    for (const [key, entry] of Object.entries(value)) {
        if (isPlainObject(entry))
            entries[key] = entry;
    }
    return entries;
}

export function parseDiagnostics(text) {
    try {
        const value = JSON.parse(text);
        return {
            modules: objectEntries(value?.modules),
            resources: objectEntries(value?.resources),
            log: Array.isArray(value?.log)
                ? value.log.filter(entry => isPlainObject(entry))
                : [],
        };
    } catch {
        return {modules: {}, resources: {}, log: []};
    }
}
