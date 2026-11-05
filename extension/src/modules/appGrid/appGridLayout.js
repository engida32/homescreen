import GLib from 'gi://GLib';

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

export function buildLayoutVariant(pages) {
    const layout = pages.map(page => {
        const data = {};
        page.forEach((entry, index) => {
            data[entry.id] = new GLib.Variant('a{sv}', {
                position: GLib.Variant.new_int32(index),
            });
        });
        return data;
    });
    return new GLib.Variant('aa{sv}', layout);
}

export function createLaunchpadToggle(overview, originalToggle, appGridState) {
    return () => {
        if (overview.isDummy || overview.visible)
            return originalToggle.call(overview);
        return overview.show(appGridState);
    };
}

export function applyGridShape(layout, {rows, columns, iconSize}) {
    layout.fixedIconSize = iconSize;
    layout._fixedCols = columns;
    layout._fixedRows = rows;
    layout._pageWidth = -1;
    layout._pageHeight = -1;
}

export function restoreGridShape(layout, original) {
    layout.fixedIconSize = original.fixedIconSize;
    layout._fixedCols = original.fixedCols;
    layout._fixedRows = original.fixedRows;
    layout.columns_per_page = original.columnsPerPage;
    layout.rows_per_page = original.rowsPerPage;
    layout._pageWidth = -1;
    layout._pageHeight = -1;
}
