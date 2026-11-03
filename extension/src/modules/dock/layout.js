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

export function dockLength(count, iconSize, spacing, padding) {
    return dockWidth(count, iconSize, spacing, padding);
}

export function dockThickness(iconSize, padding, indicatorSpace = 10) {
    return dockHeight(iconSize, padding, indicatorSpace);
}

export function dockBounds(position, monitor, count, iconSize, spacing, padding, margin) {
    const length = dockLength(count, iconSize, spacing, padding);
    const thickness = dockThickness(iconSize, padding);

    if (position === 'left') {
        return {
            x: monitor.x + margin,
            y: monitor.y + Math.round((monitor.height - length) / 2),
            width: thickness,
            height: length,
        };
    }

    if (position === 'right') {
        return {
            x: monitor.x + monitor.width - thickness - margin,
            y: monitor.y + Math.round((monitor.height - length) / 2),
            width: thickness,
            height: length,
        };
    }

    return {
        x: monitor.x + Math.round((monitor.width - length) / 2),
        y: monitor.y + monitor.height - thickness - margin,
        width: length,
        height: thickness,
    };
}

export function hiddenDockPosition(position, monitor, margin, bounds) {
    if (position === 'left')
        return {x: monitor.x - bounds.width + 2, y: bounds.y};
    if (position === 'right')
        return {x: monitor.x + monitor.width - 2, y: bounds.y};
    return {x: bounds.x, y: monitor.y + monitor.height - 2};
}

export function pointerAtDockEdge(position, monitor, x, y, threshold = 2) {
    if (position === 'left')
        return x >= monitor.x && x < monitor.x + threshold &&
            y >= monitor.y && y < monitor.y + monitor.height;
    if (position === 'right')
        return x >= monitor.x + monitor.width - threshold && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height;
    return y >= monitor.y + monitor.height - threshold && y < monitor.y + monitor.height &&
        x >= monitor.x && x < monitor.x + monitor.width;
}

export function slotCenterForAxis(index, iconSize, spacing, padding, vertical) {
    return slotCenter(index, iconSize, spacing, padding);
}

export function rectsOverlap(a, b) {
    return a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
}
