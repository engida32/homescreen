import GLib from 'gi://GLib';

import {
    formatClock,
    formatDate,
    hasMessage,
} from '../extension/src/modules/lockscreen/format.js';
import {assert, assertEqual} from './helpers.js';

const date = GLib.DateTime.new_local(2026, 11, 4, 9, 5, 0);

assertEqual(formatClock(date, '%H:%M'), '09:05', 'clock format uses GLib strftime');
assertEqual(formatClock(date, '%I:%M %p'), '09:05 AM', 'clock format supports 12 hour');
assertEqual(formatDate(date, '%A, %B %-d'), 'Wednesday, November 4', 'date format');
assert(hasMessage('  Focus  '), 'trimmed non-empty message is visible');
assert(!hasMessage('   '), 'whitespace-only message is hidden');

print('lockscreen format tests passed');
