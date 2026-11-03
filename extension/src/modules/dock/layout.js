export function dockWidth(count, iconSize, spacing, padding) {
    if (count <= 0)
        return padding * 2;
    return count * iconSize + (count - 1) * spacing + padding * 2;
}

export function dockHeight(iconSize, padding, indicatorSpace = 10) {
    return iconSize + padding * 2 + indicatorSpace;
}

export function slotCenter(index, iconSize, spacing, padding) {
    return padding + index * (iconSize + spacing) + iconSize / 2;
}

export function dockOrigin(monitor, width, height, margin) {
    return {
        x: monitor.x + Math.round((monitor.width - width) / 2),
        y: monitor.y + monitor.height - height - margin,
    };
}

export function hiddenDockY(monitor, margin) {
    return monitor.y + monitor.height - 2;
}
