import GLib from 'gi://GLib';

export const INTERNAL_KEYS = new Set([
    'diagnostics-json',
    'diagnostics-request',
    'reload-request',
    'user-presets-json',
]);

export const MODULE_KEYS = {
    panel: [
        'panel-enabled', 'panel-mode', 'panel-show-in-overview',
        'panel-show-fullscreen', 'panel-hide-delay', 'panel-reveal-pressure',
        'panel-pressure-timeout', 'panel-animation-time',
        'panel-toggle-shortcut', 'panel-show-workspace-indicator',
    ],
    dock: [
        'dock-enabled', 'dock-position', 'dock-icon-size', 'dock-spacing',
        'dock-padding', 'dock-margin', 'dock-radius', 'dock-opacity',
        'dock-autohide', 'dock-intellihide', 'dock-magnification',
        'dock-magnification-strength', 'dock-hide-delay',
    ],
    desktop: [
        'desktop-enabled', 'desktop-hide-icons', 'desktop-focus-mode',
        'desktop-show-desktop-shortcut', 'desktop-mute-notifications',
        'desktop-caffeine', 'desktop-macos-controls',
    ],
    lockscreen: [
        'lockscreen-enabled', 'lockscreen-clock-format',
        'lockscreen-date-format', 'lockscreen-message',
        'lockscreen-wallpaper-uri',
    ],
    visual: [
        'visual-enabled', 'visual-blur-panel', 'visual-blur-dock',
        'visual-blur-radius', 'visual-blur-brightness',
        'visual-blur-overview',
    ],
    tiling: [
        'tiling-enabled', 'tiling-gap', 'tiling-half-left-shortcut',
        'tiling-half-right-shortcut', 'tiling-half-top-shortcut',
        'tiling-half-bottom-shortcut', 'tiling-quarter-top-left-shortcut',
        'tiling-quarter-top-right-shortcut',
        'tiling-quarter-bottom-left-shortcut',
        'tiling-quarter-bottom-right-shortcut', 'tiling-full-shortcut',
    ],
    monitor: [
        'monitor-enabled', 'monitor-interval', 'monitor-show-memory',
        'monitor-show-disk', 'monitor-show-network',
        'monitor-show-temperature',
    ],
    'app-grid': [
        'app-grid-enabled', 'app-grid-alphabetical', 'app-grid-rows',
        'app-grid-columns', 'app-grid-icon-size', 'app-grid-show-labels',
        'app-grid-disable-remote-search', 'app-grid-launchpad',
    ],
};

export const BUILTIN_PRESETS = [
    {
        id: 'clean',
        name: 'Clean',
        description: 'Autohide panel and dock, hidden desktop icons, no heavy effects.',
        overrides: {},
    },
    {
        id: 'sonoma',
        name: 'Sonoma',
        description: 'Glass panel and dock, magnification, Launchpad grid, macOS controls.',
        overrides: {
            'visual-enabled': true,
            'visual-blur-panel': true,
            'visual-blur-dock': true,
            'visual-blur-overview': true,
            'dock-radius': 28,
            'lockscreen-enabled': true,
            'app-grid-enabled': true,
            'app-grid-launchpad': true,
            'desktop-macos-controls': true,
        },
    },
    {
        id: 'power',
        name: 'Power',
        description: 'Visible panel, workspace indicator, visible dock, monitor and tiling.',
        overrides: {
            'panel-mode': 'always',
            'panel-show-workspace-indicator': true,
            'dock-autohide': false,
            'dock-intellihide': false,
            'monitor-enabled': true,
            'tiling-enabled': true,
        },
    },
    {
        id: 'presentation',
        name: 'Presentation',
        description: 'Hidden panel and dock, muted notifications, Caffeine on.',
        overrides: {
            'panel-mode': 'hidden',
            'dock-enabled': false,
            'desktop-mute-notifications': true,
            'desktop-caffeine': true,
            'visual-enabled': false,
            'monitor-enabled': false,
            'tiling-enabled': false,
            'app-grid-enabled': false,
            'lockscreen-enabled': false,
        },
    },
    {
        id: 'minimal',
        name: 'Minimal',
        description: 'Visible panel, dock off, no effects, no monitor.',
        overrides: {
            'panel-mode': 'always',
            'dock-enabled': false,
            'desktop-hide-icons': true,
            'visual-enabled': false,
            'monitor-enabled': false,
            'tiling-enabled': false,
            'app-grid-enabled': false,
            'lockscreen-enabled': false,
        },
    },
];

function userFacingKeys(settings) {
    return settings.list_keys().filter(key => !INTERNAL_KEYS.has(key));
}

function variantFor(settings, key, value) {
    const type = settings.get_default_value(key).get_type_string();
    return new GLib.Variant(type, value);
}

function valueAllowed(settings, key, value) {
    const type = settings.get_default_value(key).get_type_string();
    if (type === 'b' && typeof value !== 'boolean')
        return false;
    if (type === 'i' && !Number.isInteger(value))
        return false;
    if (type === 'd' && typeof value !== 'number')
        return false;
    if (type === 's' && typeof value !== 'string')
        return false;
    if (type === 'as' && (!Array.isArray(value) ||
        value.some(item => typeof item !== 'string')))
        return false;

    const [kind, range] = settings.get_range(key).deepUnpack();
    if (kind === 'range') {
        const [min, max] = range.deepUnpack();
        return typeof value === 'number' && value >= min && value <= max;
    }
    if (kind === 'enum')
        return range.deepUnpack().includes(value);
    return true;
}

export function builtinPresets(settings) {
    const keys = userFacingKeys(settings);
    return BUILTIN_PRESETS.map(definition => {
        const values = {};
        for (const key of keys)
            values[key] = settings.get_default_value(key).deepUnpack();
        Object.assign(values, definition.overrides);
        return {
            id: definition.id,
            name: definition.name,
            description: definition.description,
            settings: values,
        };
    });
}

export function snapshotSettings(settings) {
    const values = {};
    for (const key of userFacingKeys(settings))
        values[key] = settings.get_value(key).deepUnpack();
    return values;
}

export function applySettings(settings, values) {
    const known = new Set(settings.list_keys());
    let applied = 0;
    const skipped = [];

    for (const [key, value] of Object.entries(values)) {
        if (INTERNAL_KEYS.has(key) || !known.has(key)) {
            skipped.push(key);
            continue;
        }
        if (!valueAllowed(settings, key, value)) {
            skipped.push(key);
            continue;
        }
        try {
            settings.set_value(key, variantFor(settings, key, value));
            applied++;
        } catch {
            skipped.push(key);
        }
    }

    return {applied, skipped};
}

export function bumpReload(settings) {
    settings.set_int('reload-request', settings.get_int('reload-request') + 1);
}

export function applyPreset(settings, preset) {
    const result = applySettings(settings, preset.settings);
    bumpReload(settings);
    return result;
}

export function loadUserPresets(settings) {
    try {
        const value = JSON.parse(settings.get_string('user-presets-json'));
        if (!Array.isArray(value))
            return [];
        return value.filter(preset => preset && typeof preset === 'object' &&
            !Array.isArray(preset) && typeof preset.name === 'string' &&
            preset.name.trim() && preset.settings &&
            typeof preset.settings === 'object' &&
            !Array.isArray(preset.settings));
    } catch {
        return [];
    }
}

export function writeUserPresets(settings, presets) {
    settings.set_string('user-presets-json', JSON.stringify(presets));
}

export function saveUserPreset(settings, name) {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed)
        throw new Error('Preset name is required');
    const presets = loadUserPresets(settings);
    presets.push({name: trimmed, settings: snapshotSettings(settings)});
    writeUserPresets(settings, presets);
    return presets;
}

export function exportPayload(settings) {
    return {
        version: 1,
        settings: snapshotSettings(settings),
        userPresets: loadUserPresets(settings),
    };
}

export function validateImportPayload(payload, settings) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Import must be a JSON object');
    if (payload.version !== 1)
        throw new Error('Unsupported import version');
    if (!payload.settings || typeof payload.settings !== 'object' ||
        Array.isArray(payload.settings)) {
        throw new Error('Import settings must be an object');
    }

    const known = new Set(settings.list_keys());
    const valid = {};
    const skipped = [];

    for (const [key, value] of Object.entries(payload.settings)) {
        if (INTERNAL_KEYS.has(key) || !known.has(key)) {
            skipped.push(key);
            continue;
        }
        try {
            variantFor(settings, key, value);
            if (!valueAllowed(settings, key, value)) {
                skipped.push(key);
                continue;
            }
            valid[key] = value;
        } catch {
            skipped.push(key);
        }
    }

    let userPresets;
    if ('userPresets' in payload) {
        if (!Array.isArray(payload.userPresets))
            throw new Error('Import userPresets must be an array');
        userPresets = payload.userPresets
            .filter(preset => preset && typeof preset === 'object' &&
                !Array.isArray(preset) &&
                typeof preset.name === 'string' && preset.name.trim() &&
                preset.settings && typeof preset.settings === 'object' &&
                !Array.isArray(preset.settings))
            .map(preset => ({
                name: preset.name.trim().slice(0, 80),
                settings: preset.settings,
            }));
    }

    return {settings: valid, userPresets, skipped};
}

export function applyImport(settings, validated) {
    const result = applySettings(settings, validated.settings);
    if (validated.userPresets)
        writeUserPresets(settings, validated.userPresets);
    bumpReload(settings);
    return {
        ...result,
        importedPresets: validated.userPresets
            ? validated.userPresets.length
            : 0,
    };
}

export function resetModule(settings, moduleId) {
    const keys = MODULE_KEYS[moduleId];
    if (!keys)
        throw new Error(`Unknown module ${moduleId}`);
    for (const key of keys)
        settings.reset(key);
    bumpReload(settings);
}

export function resetAll(settings) {
    for (const key of userFacingKeys(settings))
        settings.reset(key);
    bumpReload(settings);
}
