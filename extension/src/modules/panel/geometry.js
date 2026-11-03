export function rectsOverlap(a, b) {
    return a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
}

export function targetY(baseY, height, hidden) {
    return hidden ? baseY - height : baseY;
}

export function modeHides(mode) {
    return mode !== 'always';
}

export function shouldHidePanel({
    mode,
    forcedHidden,
    overviewVisible,
    showInOverview,
    overlaps,
    pointerInPanel = false,
}) {
    if (forcedHidden || mode === 'hidden')
        return true;
    if (mode === 'always')
        return false;
    if (overviewVisible)
        return !showInOverview;
    if (pointerInPanel)
        return false;
    if (mode === 'intellihide')
        return !overlaps;
    return true;
}
