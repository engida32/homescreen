export function formatClock(dateTime, format) {
    return dateTime.format(format) ?? '';
}

export function formatDate(dateTime, format) {
    return dateTime.format(format) ?? '';
}

export function hasMessage(message) {
    return Boolean(message?.trim());
}
