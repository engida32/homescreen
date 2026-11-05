import {assertEqual} from './helpers.js';
import {parseDiagnostics} from '../extension/src/prefs/diagnosticsFormat.js';

const parsed = parseDiagnostics(JSON.stringify({
    modules: {panel: {status: 'enabled', detail: ''}},
    resources: {panel: {signals: 2, sources: 1}},
    log: [{level: 'info', message: 'panel enabled', time: 1}],
}));
assertEqual(parsed.modules.panel.status, 'enabled', 'module parsed');
assertEqual(parsed.resources.panel.signals, 2, 'resource parsed');
assertEqual(parsed.log.length, 1, 'log parsed');

const empty = parseDiagnostics('not json');
assertEqual(Object.keys(empty.modules).length, 0, 'invalid modules empty');
assertEqual(Object.keys(empty.resources).length, 0, 'invalid resources empty');
assertEqual(empty.log.length, 0, 'invalid log empty');

const nullModule = parseDiagnostics(JSON.stringify({modules: {panel: null}}));
assertEqual(Object.keys(nullModule.modules).length, 0, 'null module dropped');

const nullResource = parseDiagnostics(JSON.stringify({resources: {panel: null}}));
assertEqual(Object.keys(nullResource.resources).length, 0, 'null resource dropped');

const nullLog = parseDiagnostics(JSON.stringify({log: [null]}));
assertEqual(nullLog.log.length, 0, 'null log entry dropped');

const arrayShapes = parseDiagnostics(JSON.stringify({
    modules: [],
    resources: [],
    log: {},
}));
assertEqual(Object.keys(arrayShapes.modules).length, 0, 'array modules rejected');
assertEqual(Object.keys(arrayShapes.resources).length, 0, 'array resources rejected');
assertEqual(arrayShapes.log.length, 0, 'non-array log rejected');

const mixed = parseDiagnostics(JSON.stringify({
    modules: {panel: {status: 'enabled'}, dock: null, visual: []},
    resources: {panel: {signals: 1}, dock: null},
    log: [{message: 'ok'}, null, ['bad']],
}));
assertEqual(Object.keys(mixed.modules).join(','), 'panel', 'invalid modules dropped');
assertEqual(Object.keys(mixed.resources).join(','), 'panel', 'invalid resources dropped');
assertEqual(mixed.log.length, 1, 'invalid log entries dropped');

print('diagnostics format tests passed');
