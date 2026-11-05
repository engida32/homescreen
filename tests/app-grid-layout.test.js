import GLib from 'gi://GLib';

import {
    applyGridShape,
    buildAlphabeticalPages,
    buildLayoutVariant,
    createLaunchpadToggle,
    pageEntries,
    restoreGridShape,
    sortEntriesByName,
} from '../extension/src/modules/appGrid/appGridLayout.js';
import {assert, assertEqual} from './helpers.js';

const entries = [
    {id: 'z.desktop', name: 'Zebra'},
    {id: 'a.desktop', name: 'Alpha'},
    {id: 'm.desktop', name: 'Mail'},
];
const sorted = sortEntriesByName(entries);
assertEqual(sorted.map(entry => entry.id).join(','),
    'a.desktop,m.desktop,z.desktop', 'sorted ids');
assertEqual(entries[0].id, 'z.desktop', 'sort does not mutate the input');
assertEqual(pageEntries(entries, 2).length, 2, 'page count');
assertEqual(pageEntries(entries, 2)[1].length, 1, 'last page');
const pages = buildAlphabeticalPages(entries, 2);
assertEqual(pages[0][0].id, 'a.desktop', 'first app');
assertEqual(pages[1][0].id, 'z.desktop', 'last app');
assertEqual(buildAlphabeticalPages([], 2).length, 0, 'empty pages');

let threw = false;
try {
    pageEntries(entries, 0);
} catch {
    threw = true;
}
assert(threw, 'zero page size throws');

threw = false;
try {
    pageEntries(entries, 1.5);
} catch {
    threw = true;
}
assert(threw, 'fractional page size throws');

const variant = buildLayoutVariant([
    [{id: 'a.desktop'}, {id: 'b.desktop'}],
    [{id: 'c.desktop'}],
]);
assertEqual(variant.get_type_string(), 'aa{sv}', 'layout variant type');
const unpacked = variant.recursiveUnpack();
assertEqual(unpacked.length, 2, 'layout page count');
assertEqual(unpacked[0]['a.desktop'].position, 0, 'first app position');
assertEqual(unpacked[0]['b.desktop'].position, 1, 'second app position');
assertEqual(unpacked[1]['c.desktop'].position, 0, 'new page position');

const shape = {};
applyGridShape(shape, {rows: 3, columns: 5, iconSize: 48});
assertEqual(shape.fixedIconSize, 48, 'shape icon size');
assertEqual(shape._fixedCols, 5, 'shape columns');
assertEqual(shape._fixedRows, 3, 'shape rows');
assertEqual(shape._pageWidth, -1, 'shape page width reset');
assertEqual(shape._pageHeight, -1, 'shape page height reset');

const original = {
    fixedIconSize: -1,
    fixedCols: undefined,
    fixedRows: undefined,
    columnsPerPage: 6,
    rowsPerPage: 4,
    pageWidth: 1920,
    pageHeight: 1080,
};
const restored = {
    fixedIconSize: 64,
    _fixedCols: 5,
    _fixedRows: 3,
    columns_per_page: 5,
    rows_per_page: 3,
    _pageWidth: 1920,
    _pageHeight: 1080,
    _iconSize: 64,
};
restoreGridShape(restored, original);
assertEqual(restored.fixedIconSize, -1, 'restore fixed icon size');
assertEqual(restored._fixedCols, undefined, 'restore fixed columns');
assertEqual(restored._fixedRows, undefined, 'restore fixed rows');
assertEqual(restored.columns_per_page, 6, 'restore columns per page');
assertEqual(restored.rows_per_page, 4, 'restore rows per page');
assertEqual(restored._pageWidth, -1, 'restore forces page width recompute');
assertEqual(restored._pageHeight, -1, 'restore forces page height recompute');

const calls = [];
const overview = {
    isDummy: false,
    visible: false,
    show(state) {
        calls.push(['show', state]);
    },
};
const originalToggle = () => calls.push(['original']);
const launchpadToggle = createLaunchpadToggle(overview, originalToggle, 2);
launchpadToggle();
assertEqual(calls[0][0], 'show', 'launchpad opens the grid when hidden');
assertEqual(calls[0][1], 2, 'launchpad uses the app grid state');
overview.visible = true;
launchpadToggle();
assertEqual(calls[1][0], 'original', 'launchpad delegates while visible');
overview.visible = false;
overview.isDummy = true;
launchpadToggle();
assertEqual(calls[2][0], 'original', 'launchpad delegates for a dummy overview');

print('app grid layout tests passed');
