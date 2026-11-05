export function parseDiagnostics(text) {
    try {
        const value = JSON.parse(text);
        return {
            modules: value?.modules && typeof value.modules === 'object'
                ? value.modules
                : {},
            resources: value?.resources && typeof value.resources === 'object'
                ? value.resources
                : {},
            log: Array.isArray(value?.log) ? value.log : [],
        };
    } catch {
        return {modules: {}, resources: {}, log: []};
    }
}
