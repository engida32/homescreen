const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function clamp(value, lower, upper) {
    return Math.min(upper, Math.max(lower, value));
}

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

export function parseCpuStat(text) {
    if (typeof text !== 'string')
        return null;

    const line = text.split('\n').find(candidate => /^cpu\s/.test(candidate));
    if (!line)
        return null;

    const fields = line.trim().split(/\s+/).slice(1).map(Number);
    if (fields.length < 4 || fields.some(value => !Number.isFinite(value)))
        return null;

    const values = fields.slice(0, 8);
    while (values.length < 8)
        values.push(0);

    return {
        total: values.reduce((sum, value) => sum + value, 0),
        idle: values[3] + values[4],
    };
}

export function cpuUsage(previous, current) {
    if (!previous || !current)
        return 0;

    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    if (total <= 0)
        return 0;

    return clamp(100 * (1 - idle / total), 0, 100);
}

export function parseMemInfo(text) {
    if (typeof text !== 'string')
        return null;

    const values = new Map();
    for (const line of text.split('\n')) {
        const match = /^([^:]+):\s+(\d+)\s*kB/i.exec(line);
        if (match)
            values.set(match[1].trim(), Number(match[2]));
    }

    const totalKb = values.get('MemTotal');
    if (!Number.isFinite(totalKb) || totalKb <= 0)
        return null;

    const availableKb = values.has('MemAvailable')
        ? values.get('MemAvailable')
        : (values.get('MemFree') ?? 0) +
          (values.get('Buffers') ?? 0) +
          (values.get('Cached') ?? 0);

    if (!Number.isFinite(availableKb) || availableKb < 0)
        return null;

    const totalBytes = totalKb * 1024;
    const availableBytes = Math.min(totalBytes, availableKb * 1024);
    const usedBytes = totalBytes - availableBytes;

    return {
        totalBytes,
        availableBytes,
        usedBytes,
        percent: clamp(100 * usedBytes / totalBytes, 0, 100),
    };
}

export function parseNetDev(text) {
    if (typeof text !== 'string')
        return null;

    let rxBytes = 0;
    let txBytes = 0;

    for (const line of text.split('\n')) {
        const separator = line.indexOf(':');
        if (separator < 0)
            continue;

        const name = line.slice(0, separator).trim();
        if (!name || name === 'lo')
            continue;

        const fields = line.slice(separator + 1).trim().split(/\s+/).map(Number);
        if (fields.length < 9 || fields.some(value => !Number.isFinite(value)))
            continue;

        rxBytes += fields[0];
        txBytes += fields[8];
    }

    return {rxBytes, txBytes};
}

export function networkRates(previous, current, elapsed) {
    if (!previous || !current || !finite(elapsed) || elapsed <= 0)
        return {rxPerSecond: 0, txPerSecond: 0};

    return {
        rxPerSecond: Math.max(0, current.rxBytes - previous.rxBytes) / elapsed,
        txPerSecond: Math.max(0, current.txBytes - previous.txBytes) / elapsed,
    };
}

export function parseThermal(text) {
    if (typeof text !== 'string')
        return null;

    const value = Number.parseFloat(text.trim());
    if (!Number.isFinite(value))
        return null;

    return value > 1000 ? value / 1000 : value;
}

export function diskUsage(size, free) {
    if (!finite(size) || !finite(free) || size <= 0 || free < 0)
        return null;

    const totalBytes = size;
    const freeBytes = Math.min(size, free);
    const usedBytes = totalBytes - freeBytes;

    return {
        totalBytes,
        freeBytes,
        usedBytes,
        percent: clamp(100 * usedBytes / totalBytes, 0, 100),
    };
}

export function formatBytes(bytes) {
    if (!finite(bytes) || bytes < 0)
        return '—';

    if (bytes < 1024)
        return `${Math.round(bytes)} B`;

    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit++;
    }

    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return `${rounded} ${BYTE_UNITS[unit]}`;
}

export function formatPercent(value) {
    if (!finite(value))
        return '—';
    return `${Math.round(clamp(value, 0, 100))}%`;
}

export function formatRate(bytesPerSecond) {
    if (!finite(bytesPerSecond) || bytesPerSecond < 0)
        return '—';
    return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatTemperature(value) {
    if (!finite(value))
        return '—';
    return `${Math.round(value)} °C`;
}

export function sparklinePoints(values, width, height, min, max) {
    if (!Array.isArray(values) || values.length === 0)
        return [];
    if (!finite(width) || !finite(height) || width <= 0 || height <= 0)
        return [];

    const finiteValues = values.filter(finite);
    if (finiteValues.length === 0)
        return [];

    let lower = finite(min) ? min : Math.min(...finiteValues);
    let upper = finite(max) ? max : Math.max(...finiteValues);
    if (upper <= lower)
        upper = lower + 1;

    return finiteValues.map((value, index) => {
        const x = finiteValues.length === 1
            ? 0
            : index / (finiteValues.length - 1) * width;
        const y = height - clamp((value - lower) / (upper - lower), 0, 1) * height;
        return [x, y];
    });
}
