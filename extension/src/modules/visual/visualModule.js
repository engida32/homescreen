import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BlurController} from './blur.js';

const BLUR_NAME = 'homescreen-blur';
const OVERVIEW_BLUR_NAME = 'homescreen-overview-blur';
const PANEL_CLASS = 'homescreen-panel-blurred';
const SETTINGS_KEYS = [
    'visual-blur-panel',
    'visual-blur-dock',
    'visual-blur-overview',
    'visual-blur-radius',
    'visual-blur-brightness',
];

export class VisualModule {
    constructor() {
        this._settings = null;
        this._scope = null;
        this._context = null;
        this._controller = null;
        this._themeContext = null;
        this._panel = null;
        // GNOME Shell 50.1 layout.js: _backgroundGroup is private and holds
        // the wallpaper actors below global.window_group.
        this._backgroundGroup = null;
        this._overviewShowing = false;
    }

    enable(context) {
        this._settings = context.settings;
        this._scope = context.scope;
        this._context = context;
        this._panel = Main.panel ?? null;
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._backgroundGroup = Main.layoutManager?._backgroundGroup ?? null;
        this._overviewShowing = Main.overview?.visible ?? false;

        this._controller = new BlurController({
            effectFactory: name => new Shell.BlurEffect({name}),
            scaleFactor: this._themeContext.scale_factor || 1,
        });

        for (const key of SETTINGS_KEYS)
            this._scope.signal(this._settings, `changed::${key}`, () => this._sync());

        this._scope.signal(this._themeContext, 'notify::scale-factor', () => {
            this._controller?.setScaleFactor(this._themeContext.scale_factor || 1);
        });

        if (Main.overview) {
            this._scope.signal(Main.overview, 'showing', () => {
                this._overviewShowing = true;
                this._syncOverview();
            });
            this._scope.signal(Main.overview, 'hiding', () => {
                this._overviewShowing = false;
                this._syncOverview();
            });
        }

        this._sync();
    }

    _sync() {
        this._syncPanel();
        this._syncDock();
        this._syncOverview();
    }

    _syncPanel() {
        if (!this._panel)
            return;

        const blur = this._settings.get_boolean('visual-blur-panel');
        if (!blur) {
            this._controller.remove(this._panel, BLUR_NAME);
            this._panel.remove_style_class_name(PANEL_CLASS);
            return;
        }

        try {
            this._controller.apply(this._panel, {
                name: BLUR_NAME,
                radius: this._settings.get_int('visual-blur-radius'),
                brightness: this._settings.get_double('visual-blur-brightness'),
                // Shell.BlurMode.BACKGROUND blurs pixels beneath the actor,
                // not the panel text. Verified against GNOME Shell 50.1.
                mode: Shell.BlurMode.BACKGROUND,
            });
            this._panel.add_style_class_name(PANEL_CLASS);
        } catch (error) {
            this._controller.remove(this._panel, BLUR_NAME);
            this._panel.remove_style_class_name(PANEL_CLASS);
            this._context.logger.error('panel blur failed', error);
        }
    }

    _syncDock() {
        const dock = this._context.getModule('dock');
        const background = dock?.getBackgroundActor?.() ?? null;
        const requested = this._settings.get_boolean('visual-blur-dock');

        if (!requested) {
            if (background)
                this._controller.remove(background, BLUR_NAME);
            dock?.setBlurred?.(false);
            return;
        }

        let applied = false;
        if (background) {
            try {
                this._controller.apply(background, {
                    name: BLUR_NAME,
                    radius: this._settings.get_int('visual-blur-radius'),
                    brightness: this._settings.get_double('visual-blur-brightness'),
                    mode: Shell.BlurMode.BACKGROUND,
                });
                applied = true;
            } catch (error) {
                this._context.logger.error('dock blur failed', error);
            }
        }

        dock?.setBlurred?.(applied);
    }

    _syncOverview() {
        if (!this._backgroundGroup)
            return;

        const requested = this._settings.get_boolean('visual-blur-overview') &&
            this._overviewShowing;

        if (!requested) {
            this._controller.remove(this._backgroundGroup, OVERVIEW_BLUR_NAME);
            return;
        }

        try {
            this._controller.apply(this._backgroundGroup, {
                name: OVERVIEW_BLUR_NAME,
                radius: this._settings.get_int('visual-blur-radius'),
                brightness: this._settings.get_double('visual-blur-brightness'),
                // Shell.BlurMode.ACTOR blurs the wallpaper actor itself.
                // Verified against GNOME Shell 50.1.
                mode: Shell.BlurMode.ACTOR,
            });
        } catch (error) {
            this._controller.remove(this._backgroundGroup, OVERVIEW_BLUR_NAME);
            this._context.logger.error('overview blur failed', error);
        }
    }

    disable() {
        this._controller?.removeAll();
        try {
            this._panel?.remove_style_class_name(PANEL_CLASS);
        } catch {
            // The panel may already be gone during shell shutdown.
        }
        try {
            this._context?.getModule('dock')?.setBlurred?.(false);
        } catch {
            // Best-effort cleanup.
        }
        this._controller = null;
        this._themeContext = null;
        this._panel = null;
        this._backgroundGroup = null;
        this._overviewShowing = false;
        this._context = null;
        this._settings = null;
        this._scope = null;
    }
}
