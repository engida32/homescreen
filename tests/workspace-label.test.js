import {assertEqual} from './helpers.js';
import {workspaceLabel} from '../extension/src/modules/panel/workspaceLabel.js';

assertEqual(workspaceLabel(0), '1', 'first workspace');
assertEqual(workspaceLabel(3), '4', 'fourth workspace');
print('workspace label tests passed');
