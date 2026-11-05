import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

function linkRow(title, uri) {
    const row = new Adw.ActionRow({
        title,
        subtitle: uri,
        activatable: true,
    });
    row.connect('activated', () => {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch {
            // Best-effort link opening.
        }
    });
    return row;
}

export function buildAboutPage(window, metadata) {
    const page = new Adw.PreferencesPage({
        title: 'About',
        icon_name: 'help-about-symbolic',
    });
    window.add(page);

    const about = new Adw.PreferencesGroup({title: 'Homescreen'});
    page.add(about);
    about.add(new Adw.ActionRow({
        title: 'Version',
        subtitle: metadata.version ?? 'Unknown',
    }));
    about.add(new Adw.ActionRow({
        title: 'UUID',
        subtitle: metadata.uuid ?? '',
    }));
    about.add(new Adw.ActionRow({
        title: 'Shell versions',
        subtitle: (metadata['shell-version'] ?? []).join(', '),
    }));
    about.add(new Adw.ActionRow({
        title: 'License',
        subtitle: 'GPL-3.0-or-later',
    }));

    const links = new Adw.PreferencesGroup({title: 'Links'});
    page.add(links);
    links.add(linkRow('Repository',
        'https://github.com/engida32/homescreen'));
    links.add(linkRow('Issues',
        'https://github.com/engida32/homescreen/issues'));

    return page;
}
