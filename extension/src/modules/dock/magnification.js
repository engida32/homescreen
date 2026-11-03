export function scaleForDistance(distance, slot, strength = 0.35, falloff = 1.4) {
    if (slot <= 0)
        return 1;
    const normalized = distance / slot;
    const scale = 1 + strength * Math.exp(-Math.pow(normalized / falloff, 2));
    return Math.min(1.45, Math.max(1, scale));
}

export function scalesForCenters(pointerX, centers, slot, strength = 0.35, falloff = 1.4) {
    return centers.map(center =>
        scaleForDistance(Math.abs(pointerX - center), slot, strength, falloff)
    );
}
