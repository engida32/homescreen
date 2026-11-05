import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {workspaceLabel} from './workspaceLabel.js';

export class WorkspaceIndicator {
    constructor(scope) {
        this._scope = scope;
        this._button = new PanelMenu.Button(0.0,
            'Homescreen Workspace Indicator', false);
        this._label = new St.Label({
            text: workspaceLabel(0),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'homescreen-workspace-label',
        });
        this._button.add_child(this._label);

        // Verified against GNOME Shell 50.1 panel.js addToStatusArea.
        try {
            Main.panel.addToStatusArea('homescreen-workspace-indicator',
                this._button, 0, 'left');
        } catch (error) {
            this._button.destroy();
            throw error;
        }

        this._signalIds = [
            this._scope.signal(global.workspace_manager,
                'active-workspace-changed', () => this._update()),
            this._scope.signal(global.workspace_manager,
                'workspace-added', () => this._update()),
            this._scope.signal(global.workspace_manager,
                'workspace-removed', () => this._update()),
        ];
        this._update();
    }

    _update() {
        const index = global.workspace_manager.get_active_workspace_index();
        this._label.text = workspaceLabel(index);
    }

    destroy() {
        for (const id of this._signalIds ?? [])
            this._scope.disconnect(id);
        this._signalIds = [];
        this._button?.destroy();
        this._button = null;
        this._label = null;
    }
}
