export function shouldShowDock({
    forcedHidden = false,
    hasIcons = false,
    overviewVisible = false,
    pointerAtEdge = false,
    pointerOverDock = false,
    menuOpen = false,
    intellihide = false,
    overlaps = false,
    autohide = false,
} = {}) {
    if (forcedHidden || !hasIcons)
        return false;
    if (menuOpen || overviewVisible)
        return true;
    if (pointerAtEdge || pointerOverDock)
        return true;
    if (intellihide && overlaps)
        return false;
    if (autohide)
        return false;
    return true;
}
