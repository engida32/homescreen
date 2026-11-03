import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ROOT = Gio.File.new_for_path(
    GLib.build_filenamev([GLib.get_current_dir(), 'extension'])
);
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g;

function collectJavaScriptFiles(directory, files) {
    const enumerator = directory.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE,
        null
    );

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const child = directory.get_child(info.get_name());
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            collectJavaScriptFiles(child, files);
        else if (info.get_file_type() === Gio.FileType.REGULAR &&
                 info.get_name().endsWith('.js'))
            files.push(child);
    }

    enumerator.close(null);
}

function displayPath(file) {
    return Gio.File.new_for_path(GLib.get_current_dir()).get_relative_path(file);
}

const files = [];
collectJavaScriptFiles(ROOT, files);

const missing = [];
for (const file of files) {
    const [ok, bytes] = GLib.file_get_contents(file.get_path());
    if (!ok)
        throw new Error(`cannot read ${displayPath(file)}`);

    const source = new TextDecoder().decode(bytes);
    let match;
    while ((match = SPECIFIER.exec(source)) !== null) {
        const specifier = match[1];
        const line = source.slice(0, match.index).split('\n').length;
        const target = file.get_parent().resolve_relative_path(specifier);
        if (!GLib.file_test(target.get_path(), GLib.FileTest.EXISTS))
            missing.push(`${displayPath(file)}:${line}: ${specifier}`);
    }
}

if (missing.length > 0) {
    for (const entry of missing)
        print(entry);
    throw new Error(`${missing.length} unresolved relative import(s)`);
}

print('import resolution tests passed');
