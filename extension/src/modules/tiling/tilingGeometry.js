export const LAYOUTS = [
    'half-left',
    'half-right',
    'half-top',
    'half-bottom',
    'quarter-top-left',
    'quarter-top-right',
    'quarter-bottom-left',
    'quarter-bottom-right',
    'full',
];

export const TILING_SHORTCUTS = {
    'tiling-half-left-shortcut': 'half-left',
    'tiling-half-right-shortcut': 'half-right',
    'tiling-half-top-shortcut': 'half-top',
    'tiling-half-bottom-shortcut': 'half-bottom',
    'tiling-quarter-top-left-shortcut': 'quarter-top-left',
    'tiling-quarter-top-right-shortcut': 'quarter-top-right',
    'tiling-quarter-bottom-left-shortcut': 'quarter-bottom-left',
    'tiling-quarter-bottom-right-shortcut': 'quarter-bottom-right',
    'tiling-full-shortcut': 'full',
};

export function snapRect(workArea, layout, gap = 0) {
    const x = Math.round(workArea.x ?? 0);
    const y = Math.round(workArea.y ?? 0);
    const width = Math.max(1, Math.floor(workArea.width ?? 0));
    const height = Math.max(1, Math.floor(workArea.height ?? 0));

    const requestedGap = Math.floor(Number(gap) || 0);
    const maxGap = Math.min(
        Math.floor((width - 2) / 3),
        Math.floor((height - 2) / 3)
    );
    const g = Math.max(0, Math.min(requestedGap, maxGap));

    const halfWidth = Math.max(1, Math.floor((width - 3 * g) / 2));
    const halfHeight = Math.max(1, Math.floor((height - 3 * g) / 2));
    const fullWidth = Math.max(1, width - 2 * g);
    const fullHeight = Math.max(1, height - 2 * g);

    const left = x + g;
    const top = y + g;
    const right = x + 2 * g + halfWidth;
    const bottom = y + 2 * g + halfHeight;

    switch (layout) {
    case 'half-left':
        return {x: left, y: top, width: halfWidth, height: fullHeight};
    case 'half-right':
        return {x: right, y: top, width: halfWidth, height: fullHeight};
    case 'half-top':
        return {x: left, y: top, width: fullWidth, height: halfHeight};
    case 'half-bottom':
        return {x: left, y: bottom, width: fullWidth, height: halfHeight};
    case 'quarter-top-left':
        return {x: left, y: top, width: halfWidth, height: halfHeight};
    case 'quarter-top-right':
        return {x: right, y: top, width: halfWidth, height: halfHeight};
    case 'quarter-bottom-left':
        return {x: left, y: bottom, width: halfWidth, height: halfHeight};
    case 'quarter-bottom-right':
        return {x: right, y: bottom, width: halfWidth, height: halfHeight};
    case 'full':
        return {x: left, y: top, width: fullWidth, height: fullHeight};
    default:
        throw new Error(`Unknown tiling layout: ${layout}`);
    }
}
