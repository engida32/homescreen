import {
    modeHides,
    rectsOverlap,
    shouldHidePanel,
    targetY,
} from '../extension/src/modules/panel/geometry.js';
import {assert, assertEqual} from './helpers.js';

assert(rectsOverlap(
    {x: 0, y: 0, width: 100, height: 10},
    {x: 50, y: -5, width: 20, height: 20}
), 'overlapping rects');
assert(!rectsOverlap(
    {x: 0, y: 0, width: 100, height: 10},
    {x: 0, y: 10, width: 100, height: 10}
), 'bottom and top edges touching do not overlap');
assert(!rectsOverlap(
    {x: 0, y: 0, width: 100, height: 10},
    {x: 100, y: 0, width: 10, height: 10}
), 'right and left edges touching do not overlap');
assert(!rectsOverlap(
    {x: 0, y: 0, width: 100, height: 10},
    {x: 0, y: 11, width: 100, height: 10}
), 'gapped edges do not overlap');

assertEqual(targetY(0, 36, true), -36, 'hidden panel moves above the monitor');
assertEqual(targetY(0, 36, false), 0, 'visible panel returns to base');

assert(modeHides('autohide'), 'autohide hides');
assert(modeHides('intellihide'), 'intellihide hides');
assert(modeHides('hidden'), 'hidden hides');
assert(!modeHides('always'), 'always does not hide');

assert(!shouldHidePanel({
    mode: 'always',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: true,
}), 'always mode stays visible');
assert(shouldHidePanel({
    mode: 'always',
    forcedHidden: true,
    overviewVisible: false,
    showInOverview: true,
    overlaps: false,
}), 'forced hidden hides the panel');
assert(shouldHidePanel({
    mode: 'autohide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: false,
}), 'autohide hides outside the overview');
assert(!shouldHidePanel({
    mode: 'autohide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: false,
    pointerInPanel: true,
}), 'autohide stays visible while the pointer is in the panel');
assert(!shouldHidePanel({
    mode: 'intellihide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: true,
}), 'intellihide stays visible when a window overlaps');
assert(shouldHidePanel({
    mode: 'intellihide',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: false,
}), 'intellihide hides without overlap');
assert(!shouldHidePanel({
    mode: 'autohide',
    forcedHidden: false,
    overviewVisible: true,
    showInOverview: true,
    overlaps: false,
}), 'show in overview keeps the panel visible');
assert(shouldHidePanel({
    mode: 'hidden',
    forcedHidden: false,
    overviewVisible: false,
    showInOverview: true,
    overlaps: true,
}), 'hidden mode hides');

print('panel geometry tests passed');
