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

print('diagnostics format tests passed');
