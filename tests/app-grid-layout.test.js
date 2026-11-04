import {
    buildAlphabeticalPages,
    pageEntries,
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

print('app grid layout tests passed');
