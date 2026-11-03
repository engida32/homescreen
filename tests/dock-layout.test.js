import {
    dockHeight,
    dockOrigin,
    dockWidth,
    hiddenDockY,
    rectsOverlap,
    slotCenter,
} from '../extension/src/modules/dock/layout.js';
import {assert, assertEqual} from './helpers.js';

assertEqual(dockWidth(1, 52, 8, 10), 72, 'one icon plus padding');
assertEqual(dockWidth(3, 52, 8, 10), 192, 'three icons plus spacing and padding');
assertEqual(dockHeight(52, 10), 82, 'dock height includes indicator space');
assertEqual(slotCenter(0, 52, 8, 10), 36, 'first slot center');
assertEqual(slotCenter(1, 52, 8, 10), 96, 'second slot center');

const monitor = {x: 0, y: 0, width: 1000, height: 800};
assertEqual(dockOrigin(monitor, 200, 72, 10).x, 400, 'dock is centered');
assertEqual(dockOrigin(monitor, 200, 72, 10).y, 718, 'dock sits above the bottom edge');
assertEqual(hiddenDockY(monitor, 10), 798, 'hidden dock leaves a two pixel reveal strip');

assert(rectsOverlap(
    {x: 0, y: 700, width: 1000, height: 100},
    {x: 100, y: 650, width: 200, height: 100}
), 'dock overlap is detected');
assert(!rectsOverlap(
    {x: 0, y: 700, width: 1000, height: 100},
    {x: 100, y: 500, width: 200, height: 100}
), 'non-overlapping windows are ignored');
assert(!rectsOverlap(
    {x: 0, y: 700, width: 1000, height: 100},
    {x: 100, y: 600, width: 200, height: 100}
), 'a window ending above the dock does not overlap');
assert(!rectsOverlap(
    {x: 0, y: 700, width: 1000, height: 100},
    {x: 100, y: 800, width: 200, height: 100}
), 'a window starting at the dock edge does not overlap');

print('dock layout tests passed');
