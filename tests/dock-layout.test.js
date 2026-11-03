import {
    dockBounds,
    dockHeight,
    dockOrigin,
    dockWidth,
    hiddenDockPosition,
    hiddenDockY,
    pointerAtDockEdge,
    rectsOverlap,
    slotCenter,
    slotCenterForAxis,
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

const leftMonitor = {x: 0, y: 0, width: 1000, height: 800};
const left = dockBounds('left', leftMonitor, 3, 52, 8, 10, 10);
assertEqual(left.x, 10, 'left dock starts at the left margin');
assertEqual(left.width, 82, 'left dock thickness includes icon, padding, and indicator');
assertEqual(left.height, 192, 'left dock length is three icons plus spacing');
assertEqual(left.y, 304, 'left dock is vertically centered');

const right = dockBounds('right', leftMonitor, 1, 52, 8, 10, 10);
assertEqual(right.x, 908, 'right dock starts at the right edge minus width and margin');
assertEqual(right.width, 82, 'right dock thickness is stable');
assertEqual(right.y, 364, 'single icon is centered vertically');

const hiddenLeft = hiddenDockPosition('left', leftMonitor, 10, left);
assertEqual(hiddenLeft.x, -80, 'hidden left dock leaves a two pixel strip');
assertEqual(hiddenLeft.y, 304, 'hidden left dock keeps its centered y');

const hiddenRight = hiddenDockPosition('right', leftMonitor, 10, right);
assertEqual(hiddenRight.x, 998, 'hidden right dock leaves a two pixel strip');

assert(pointerAtDockEdge('left', leftMonitor, 1, 400), 'left edge is detected');
assert(pointerAtDockEdge('right', leftMonitor, 999, 400), 'right edge is detected');
assert(pointerAtDockEdge('bottom', leftMonitor, 500, 799), 'bottom edge is detected');
assert(!pointerAtDockEdge('left', leftMonitor, 20, 400), 'inside the monitor is not the edge');

assertEqual(slotCenterForAxis(0, 52, 8, 10, false), 36, 'horizontal slot');
assertEqual(slotCenterForAxis(1, 52, 8, 10, true), 96, 'vertical slot');

print('dock layout tests passed');
