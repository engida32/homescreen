import {LAYOUTS, TILING_SHORTCUTS, snapRect} from '../extension/src/modules/tiling/tilingGeometry.js';
import {assert, assertEqual} from './helpers.js';

function assertRect(actual, expected, message) {
    assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

const work = {x: 0, y: 0, width: 1920, height: 1080};

assertRect(snapRect(work, 'half-left', 8),
    {x: 8, y: 8, width: 948, height: 1064}, 'left half uses a uniform gap');
assertRect(snapRect(work, 'half-right', 8),
    {x: 964, y: 8, width: 948, height: 1064}, 'right half mirrors the left half');
assertRect(snapRect(work, 'half-top', 8),
    {x: 8, y: 8, width: 1904, height: 528}, 'top half spans the work area');
assertRect(snapRect(work, 'half-bottom', 8),
    {x: 8, y: 544, width: 1904, height: 528}, 'bottom half mirrors the top half');
assertRect(snapRect(work, 'quarter-top-left', 8),
    {x: 8, y: 8, width: 948, height: 528}, 'top-left quarter');
assertRect(snapRect(work, 'quarter-top-right', 8),
    {x: 964, y: 8, width: 948, height: 528}, 'top-right quarter');
assertRect(snapRect(work, 'quarter-bottom-left', 8),
    {x: 8, y: 544, width: 948, height: 528}, 'bottom-left quarter');
assertRect(snapRect(work, 'quarter-bottom-right', 8),
    {x: 964, y: 544, width: 948, height: 528}, 'bottom-right quarter');
assertRect(snapRect(work, 'full', 8),
    {x: 8, y: 8, width: 1904, height: 1064}, 'full layout keeps the outer gap');

assertRect(snapRect(work, 'half-left', 0),
    {x: 0, y: 0, width: 960, height: 1080}, 'zero gap fills the work area');
assertRect(snapRect(work, 'half-left', -8),
    {x: 0, y: 0, width: 960, height: 1080}, 'negative gap is clamped to zero');

const offset = {x: 100, y: 50, width: 1921, height: 1081};
assertRect(snapRect(offset, 'quarter-bottom-right', 8),
    {x: 1064, y: 594, width: 948, height: 528}, 'offset and odd sizes are handled');

const tiny = {x: 0, y: 0, width: 20, height: 20};
const tinyRect = snapRect(tiny, 'half-left', 100);
assertRect(tinyRect, {x: 6, y: 6, width: 1, height: 8},
    'oversized gap clamps and keeps positive geometry');

assertEqual(LAYOUTS.length, 9, 'all layouts are listed');
for (const layout of LAYOUTS) {
    assert(Object.values(TILING_SHORTCUTS).includes(layout),
        `shortcut mapping covers ${layout}`);
}

let threw = false;
try {
    snapRect(work, 'diagonal', 8);
} catch {
    threw = true;
}
assert(threw, 'unknown layouts throw');

print('tiling tests passed');
