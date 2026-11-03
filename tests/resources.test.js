import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {ModuleScope, SignalRegistry, SourceRegistry} from '../extension/src/core/resources.js';
import {assertEqual, waitForTimeout} from './helpers.js';

const Emitter = GObject.registerClass({
    Signals: {'ping': {}},
}, class Emitter extends GObject.Object {});

const emitter = new Emitter();
let count = 0;

const signals = new SignalRegistry();
const id = signals.connect(emitter, 'ping', () => count++);
emitter.emit('ping');
assertEqual(count, 1, 'signal fires');
signals.disconnect(id);
emitter.emit('ping');
assertEqual(count, 1, 'disconnect removes the handler');

const sourceA = new SourceRegistry();
let fired = 0;
sourceA.timeoutAdd(GLib.PRIORITY_DEFAULT, 10, () => {
    fired++;
    return GLib.SOURCE_REMOVE;
});
waitForTimeout(40);
assertEqual(fired, 1, 'timeout fires');
assertEqual(sourceA.size, 0, 'completed source is forgotten');

const sourceB = new SourceRegistry();
const busyId = sourceB.timeoutAdd(GLib.PRIORITY_DEFAULT, 50, () => GLib.SOURCE_CONTINUE);
sourceB.remove(busyId);
assertEqual(sourceB.size, 0, 'removed source is forgotten');

const scope = new ModuleScope('test');
scope.signal(emitter, 'ping', () => count++);
scope.timeout(10, () => GLib.SOURCE_REMOVE);
assertEqual(scope.signalCount, 1, 'scope counts signals');
assertEqual(scope.sourceCount, 1, 'scope counts sources');
scope.destroy();
assertEqual(scope.signalCount, 0, 'scope clears signals');
assertEqual(scope.sourceCount, 0, 'scope clears sources');
emitter.emit('ping');
assertEqual(count, 1, 'scope destroy disconnects');

print('resource tests passed');
