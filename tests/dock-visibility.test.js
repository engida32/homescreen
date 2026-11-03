import {shouldShowDock} from '../extension/src/modules/dock/visibility.js';
import {assert} from './helpers.js';

const base = {
    forcedHidden: false,
    hasIcons: true,
    overviewVisible: false,
    pointerAtEdge: false,
    pointerOverDock: false,
    menuOpen: false,
    intellihide: false,
    overlaps: false,
    autohide: false,
};

const cases = [
    [{forcedHidden: true}, false, 'forced hidden wins over everything'],
    [{forcedHidden: true, menuOpen: true, overviewVisible: true}, false, 'forced hidden beats menu and overview'],
    [{hasIcons: false}, false, 'no icons stays hidden'],
    [{hasIcons: false, pointerAtEdge: true}, false, 'no icons beats the pointer edge'],
    [{menuOpen: true}, true, 'open menu holds the dock'],
    [{menuOpen: true, overlaps: true, intellihide: true, autohide: true}, true, 'menu beats intellihide and autohide'],
    [{overviewVisible: true}, true, 'overview reveals the dock'],
    [{overviewVisible: true, overlaps: true, intellihide: true, autohide: true}, true, 'overview beats intellihide and autohide'],
    [{pointerAtEdge: true}, true, 'pointer at the edge reveals the dock'],
    [{pointerOverDock: true}, true, 'pointer over the dock reveals it'],
    [{pointerAtEdge: true, overlaps: true, intellihide: true, autohide: true}, true, 'edge pointer beats intellihide and autohide'],
    [{pointerOverDock: true, overlaps: true, intellihide: true, autohide: true}, true, 'dock pointer beats intellihide and autohide'],
    [{intellihide: true, overlaps: true}, false, 'intellihide overlap hides the dock'],
    [{intellihide: true, overlaps: true, autohide: true}, false, 'intellihide overlap hides before autohide is needed'],
    [{intellihide: true, overlaps: false}, true, 'intellihide without overlap leaves the dock shown'],
    [{intellihide: false, overlaps: true}, true, 'overlap is ignored when intellihide is off'],
    [{autohide: true}, false, 'autohide hides the dock'],
    [{autohide: false}, true, 'autohide off and no overlap leaves the dock shown'],
    [{autohide: false, intellihide: false, overlaps: true}, true, 'autohide off shows through a reported overlap'],
];

for (const [overrides, expected, message] of cases) {
    const actual = shouldShowDock({...base, ...overrides});
    assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

print('dock visibility tests passed');
