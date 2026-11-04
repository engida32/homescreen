export function sortEntriesByName(entries) {
    return [...entries].sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? ''));
}

export function pageEntries(entries, itemsPerPage) {
    if (!Number.isInteger(itemsPerPage) || itemsPerPage < 1)
        throw new Error('itemsPerPage must be a positive integer');

    const pages = [];
    for (let index = 0; index < entries.length; index += itemsPerPage)
        pages.push(entries.slice(index, index + itemsPerPage));
    return pages;
}

export function buildAlphabeticalPages(entries, itemsPerPage) {
    return pageEntries(sortEntriesByName(entries), itemsPerPage);
}
