export function dockBackgroundStyle(radius, opacity, blurred = false) {
    const color = blurred ? 'rgba(28, 28, 30, 0)' : `rgba(28, 28, 30, ${opacity})`;
    return `border-radius: ${Math.round(radius)}px; background-color: ${color};`;
}
