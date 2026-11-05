import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function spinRow(settings, key, title, subtitle, lower, upper, step) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 5,
            value: settings.get_int(key),
        }),
    });
    row.connect('notify::value', () => {
        settings.set_int(key, Math.round(row.value));
    });
    settings.connect(`changed::${key}`, () => {
        const value = settings.get_int(key);
        if (Math.round(row.value) !== value)
            row.value = value;
    });
    return row;
}

export function spinRowDouble(settings, key, title, subtitle, lower, upper, step) {
    const [mantissa, exponent] = String(step).toLowerCase().split('e-');
    const digits = Math.min(20, Math.max(0,
        (mantissa.split('.')[1]?.length ?? 0) + (exponent ? Number(exponent) : 0)));
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 5,
            value: settings.get_double(key),
        }),
    });
    row.connect('notify::value', () => {
        settings.set_double(key, row.value);
    });
    settings.connect(`changed::${key}`, () => {
        const value = settings.get_double(key);
        if (Math.abs(row.value - value) > 0.0001)
            row.value = value;
    });
    return row;
}

export function comboRow(settings, key, title, values) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(values),
    });
    const sync = () => {
        const value = settings.get_string(key);
        const index = values.indexOf(value);
        row.selected = index >= 0 ? index : 0;
    };
    row.connect('notify::selected', () => {
        const value = values[row.selected] ?? values[0];
        if (settings.get_string(key) !== value)
            settings.set_string(key, value);
    });
    settings.connect(`changed::${key}`, sync);
    sync();
    return row;
}

export function shortcutRow(settings, key, title) {
    const row = new Adw.ActionRow({title});
    const label = new Gtk.ShortcutLabel({
        accelerator: settings.get_strv(key)[0] ?? '',
        disabled_text: 'Disabled',
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(label);
    settings.connect(`changed::${key}`, () => {
        label.set_accelerator(settings.get_strv(key)[0] ?? '');
    });
    return row;
}

export function textRow(settings, key, title, subtitle = '') {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    if (subtitle)
        row.tooltip_text = subtitle;
    row.text = settings.get_string(key);
    row.connect('apply', () => settings.set_string(key, row.text));
    settings.connect(`changed::${key}`, () => {
        const value = settings.get_string(key);
        if (row.text !== value)
            row.text = value;
    });
    return row;
}
