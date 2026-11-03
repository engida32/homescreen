import {BlurController} from '../extension/src/modules/visual/blur.js';
import {assert, assertEqual} from './helpers.js';

function makeEffect() {
    return {
        radius: null,
        brightness: null,
        mode: null,
        set_radius(value) {
            this.radius = value;
        },
        set_brightness(value) {
            this.brightness = value;
        },
        set_mode(value) {
            this.mode = value;
        },
    };
}

function makeActor() {
    return {
        effects: new Map(),
        add_effect_with_name(name, effect) {
            this.effects.set(name, effect);
        },
        remove_effect_by_name(name) {
            this.effects.delete(name);
        },
        get_effect(name) {
            return this.effects.get(name) ?? null;
        },
    };
}

const effects = [];
const controller = new BlurController({
    effectFactory: name => {
        const effect = makeEffect();
        effect.name = name;
        effects.push(effect);
        return effect;
    },
    scaleFactor: 2,
});
const actor = makeActor();

controller.apply(actor, {name: 'homescreen-blur', radius: 30, brightness: 0.65, mode: 1});
assertEqual(effects.length, 1, 'one effect created');
assertEqual(effects[0].name, 'homescreen-blur', 'effect name');
assertEqual(effects[0].radius, 60, 'radius scaled by scale factor');
assertEqual(effects[0].brightness, 0.65, 'brightness applied');
assertEqual(effects[0].mode, 1, 'mode applied');
assert(actor.get_effect('homescreen-blur') === effects[0], 'effect added to actor');

controller.apply(actor, {name: 'homescreen-blur', radius: 40, brightness: 0.5, mode: 1});
assertEqual(effects.length, 1, 'second apply reuses the effect');
assertEqual(effects[0].radius, 80, 'second apply updates radius');
assertEqual(effects[0].brightness, 0.5, 'second apply updates brightness');

controller.setScaleFactor(1);
assertEqual(effects[0].radius, 40, 'scale change updates stored radius');

const secondActor = makeActor();
controller.apply(secondActor, {name: 'homescreen-blur', radius: 20, brightness: 0.65, mode: 1});
assertEqual(effects.length, 2, 'second actor gets its own effect');

controller.remove(actor, 'homescreen-blur');
assert(actor.get_effect('homescreen-blur') === null, 'remove deletes effect');
assert(secondActor.get_effect('homescreen-blur') !== null, 'remove leaves other actors alone');

controller.removeAll();
assert(secondActor.get_effect('homescreen-blur') === null, 'removeAll deletes remaining effects');

print('blur tests passed');
