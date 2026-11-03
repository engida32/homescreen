export const DING_KEYS = [
    'show-home',
    'show-trash',
    'show-volumes',
    'show-network-volumes',
];

export function snapshotDing(settings) {
    return Object.fromEntries(
        DING_KEYS.map(key => [key, settings.get_boolean(key)])
    );
}

export function hideDingIcons(settings) {
    for (const key of DING_KEYS)
        settings.set_boolean(key, false);
}

export function restoreDing(settings, snapshot) {
    for (const key of DING_KEYS) {
        if (typeof snapshot[key] === 'boolean')
            settings.set_boolean(key, snapshot[key]);
    }
}
