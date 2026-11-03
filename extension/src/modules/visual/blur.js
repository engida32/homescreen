export class BlurController {
    constructor({effectFactory, scaleFactor = 1}) {
        if (typeof effectFactory !== 'function')
            throw new Error('BlurController requires an effectFactory');
        this._effectFactory = effectFactory;
        this._scaleFactor = scaleFactor || 1;
        this._effects = new Map();
    }

    setScaleFactor(scaleFactor) {
        this._scaleFactor = scaleFactor || 1;
        for (const effects of this._effects.values()) {
            for (const entry of effects.values())
                entry.effect.set_radius(entry.radius * this._scaleFactor);
        }
    }

    apply(actor, {name = 'homescreen-blur', radius = 30, brightness = 0.65, mode} = {}) {
        if (!actor)
            return;

        let effects = this._effects.get(actor);
        if (!effects) {
            effects = new Map();
            this._effects.set(actor, effects);
        }

        let entry = effects.get(name);
        if (!entry) {
            const existing = actor.get_effect?.(name);
            if (existing) {
                entry = {effect: existing, radius};
            } else {
                const effect = this._effectFactory(name);
                actor.add_effect_with_name(name, effect);
                entry = {effect, radius};
            }
            effects.set(name, entry);
        }

        entry.radius = radius;
        entry.effect.set_radius(radius * this._scaleFactor);
        entry.effect.set_brightness(brightness);
        if (mode !== undefined)
            entry.effect.set_mode(mode);
    }

    remove(actor, name = 'homescreen-blur') {
        if (!actor)
            return;
        const effects = this._effects.get(actor);
        if (!effects)
            return;
        const entry = effects.get(name);
        if (!entry)
            return;

        try {
            actor.remove_effect_by_name(name);
        } catch {
            // The actor may already be destroyed.
        }
        effects.delete(name);
        if (effects.size === 0)
            this._effects.delete(actor);
    }

    removeAll() {
        for (const [actor, effects] of this._effects) {
            for (const name of effects.keys()) {
                try {
                    actor.remove_effect_by_name(name);
                } catch {
                    // The actor may already be destroyed.
                }
            }
        }
        this._effects.clear();
    }
}
