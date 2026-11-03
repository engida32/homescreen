import {
    scaleForDistance,
    scalesForCenters,
} from '../extension/src/modules/dock/magnification.js';
import {assert, assertEqual} from './helpers.js';

assertEqual(scaleForDistance(0, 60, 0.35, 1.4), 1.35, 'pointer at icon center');
assert(scaleForDistance(60, 60, 0.35, 1.4) < 1.35, 'neighbor scales less');
assert(scaleForDistance(600, 60, 0.35, 1.4) < 1.01, 'far icon ignores magnification');
assert(scaleForDistance(0, 60, 0.9, 1.4) <= 1.45, 'scale is clamped');

const scales = scalesForCenters(96, [36, 96, 156], 60, 0.35, 1.4);
assertEqual(scales.length, 3, 'one scale per icon');
assertEqual(scales[1], 1.35, 'hovered icon is largest');
assert(scales[0] < scales[1] && scales[2] < scales[1], 'neighbors are smaller');

print('dock magnification tests passed');
