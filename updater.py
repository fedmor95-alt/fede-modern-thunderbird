#!/usr/bin/env python3
"""Fede Modern: allowlisted, offline-first customization release installer.

No mail, identities, credentials, databases or extension storage are copied.
Only trusted release archives should be used: XPI files are executable code.
"""
import argparse
import configparser
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

ALLOWED = frozenset({
    'chrome/userChrome.css', 'chrome/userContent.css',
    'chrome/themes/fede-modern/userChrome.css', 'chrome/compose-modern.css',
    'chrome/themes/fede-modern/LICENSE',
    'chrome/compose-editor-view.css', 'chrome/search-modern.css',
    'chrome/interface-refinements.css', 'chrome/calendar-modern.css',
    'extensions/snooze@contextlab.github.io.xpi',
    'extensions/fede-day-night@local.xpi',
})
STATE = 'fede-modern-state.json'
MAX_BYTES = 8 * 1024 * 1024
PREFS = '\n// BEGIN FEDE MODERN\nuser_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);\nuser_pref("mail.threadpane.cardsview", true);\n// END FEDE MODERN\n'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.fede-modern-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as fp:
            fp.write(data)
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def safe_target(profile, rel):
    if rel not in ALLOWED | {'user.js', STATE}:
        raise ValueError('File fuori elenco consentito: ' + rel)
    target = profile / rel
    if not target.resolve().is_relative_to(profile.resolve()) or any(p.is_symlink() for p in [target, *target.parents] if p != profile):
        raise ValueError('Link simbolico non consentito: ' + rel)
    return target


def read_release(archive):
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(names)) or sum(i.file_size for i in infos) > MAX_BYTES:
            raise ValueError('Archivio duplicato o troppo grande')
        if set(names) != {'release.json'} | {'payload/' + p for p in ALLOWED}:
            raise ValueError('Contenuto del pacchetto non consentito')
        manifest = json.loads(z.read('release.json'))
        if manifest['product'] != 'fede-modern' or set(manifest['files']) != ALLOWED:
            raise ValueError('Manifest non valido')
        if not re.fullmatch(r'\d+\.\d+\.\d+', manifest['version']):
            raise ValueError('Versione non valida')
        data = {p: z.read('payload/' + p) for p in ALLOWED}
        if any(digest(data[p]) != manifest['files'][p] for p in data):
            raise ValueError('Integrità SHA-256 non valida')
        return manifest, data


def running():
    # Conservative: do not change any profile while a Thunderbird process runs.
    return subprocess.run(['pgrep', '-ix', 'thunderbird'], stdout=subprocess.DEVNULL).returncode == 0


def profile_version(profile):
    parser = configparser.ConfigParser()
    parser.read(profile / 'compatibility.ini')
    value = parser.get('Compatibility', 'LastVersion', fallback='')
    match = re.match(r'(\d+)\.', value)
    if not match:
        raise ValueError('Avvia e chiudi Thunderbird una volta per verificare versione e profilo')
    return int(match[1])


def install(archive, profile, adopt=False, dry_run=False):
    profile = Path(profile).expanduser().resolve(strict=True)
    if profile == Path.home() or profile == Path('/') or not (profile / 'prefs.js').is_file():
        raise ValueError('Serve un profilo Thunderbird esistente, non una directory generica')
    manifest, data = read_release(archive)
    major = profile_version(profile)
    if not manifest['compatibility']['min_major'] <= major <= manifest['compatibility']['max_major']:
        raise ValueError(f'Thunderbird {major} non verificato per questo pacchetto; installazione bloccata')
    state_file = safe_target(profile, STATE)
    previous = json.loads(state_file.read_text()) if state_file.exists() else None
    if previous:
        old = tuple(map(int, previous['version'].split('.')))
        new = tuple(map(int, manifest['version'].split('.')))
        if new < old:
            raise ValueError('Downgrade bloccato: usare rollback')
        if new == old and previous['files'] != manifest['files']:
            raise ValueError('Release modificata senza aumentare versione')
    for rel, content in data.items():
        target = safe_target(profile, rel)
        if not target.exists() or target.read_bytes() == content:
            continue
        expected = previous['files'].get(rel) if previous else None
        if not adopt and (expected is None or digest(target.read_bytes()) != expected):
            raise ValueError('File locale non gestito/modificato: ' + rel + '; verificare prima di usare --adopt')
    pref_file = safe_target(profile, 'user.js')
    prefs = pref_file.read_text() if pref_file.exists() else ''
    if '// BEGIN FEDE MODERN' not in prefs:
        data['user.js'] = (prefs + PREFS).encode()
    changed = {rel: content for rel, content in data.items() if not (profile / rel).exists() or (profile / rel).read_bytes() != content}
    if previous and previous['version'] == manifest['version'] and not changed:
        return {'status': 'current', 'version': manifest['version']}
    if dry_run:
        return {'status': 'preview', 'version': manifest['version'], 'files': sorted(changed), 'running': running()}
    if running():
        return {'status': 'deferred', 'reason': 'Chiudere Thunderbird; nessun file del profilo modificato'}
    lock_path = profile / '.fede-modern-update.lock'
    if lock_path.is_symlink():
        raise ValueError('Lock non valido')
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if running():
            return {'status': 'deferred', 'reason': 'Thunderbird è stato aperto'}
        backup_root = profile / 'fede-modern-backups'
        if backup_root.is_symlink():
            raise ValueError('Directory backup non valida')
        backup_root.mkdir(exist_ok=True)
        backup = Path(tempfile.mkdtemp(prefix=time.strftime('%Y%m%d-%H%M%S-'), dir=backup_root))
        record = {'profile': str(profile), 'files': {}, 'installed': {}}
        state_data = (json.dumps(manifest, indent=2) + '\n').encode()
        changed[STATE] = state_data
        for rel, content in changed.items():
            target = safe_target(profile, rel)
            if target.exists():
                original = target.read_bytes()
                atomic(backup / rel, original)
                record['files'][rel] = digest(original)
            else:
                record['files'][rel] = None
            record['installed'][rel] = digest(content)
        atomic(backup / 'backup.json', (json.dumps(record, indent=2) + '\n').encode())
        try:
            for rel, content in changed.items():
                atomic(safe_target(profile, rel), content)
        except Exception:
            restore_files(profile, backup, record)
            raise
    return {'status': 'installed', 'version': manifest['version'], 'backup': str(backup), 'files': len(changed)}


def restore_files(profile, backup, record):
    for rel, original_hash in record['files'].items():
        target = safe_target(profile, rel)
        if original_hash is None:
            if target.exists():
                target.unlink()
        else:
            atomic(target, (backup / rel).read_bytes())


def rollback(profile, backup):
    profile = Path(profile).resolve(strict=True)
    backup = Path(backup).resolve(strict=True)
    if backup.parent != profile / 'fede-modern-backups':
        raise ValueError('Backup esterno al profilo')
    if running():
        raise ValueError('Chiudere Thunderbird prima del ripristino')
    record = json.loads((backup / 'backup.json').read_text())
    if record['profile'] != str(profile):
        raise ValueError('Backup di un altro profilo')
    for rel, expected in record['installed'].items():
        target = safe_target(profile, rel)
        if not target.exists() or digest(target.read_bytes()) != expected:
            raise ValueError('Modifica successiva da preservare: ' + rel)
        old_hash = record['files'][rel]
        if old_hash is not None and digest((backup / rel).read_bytes()) != old_hash:
            raise ValueError('Backup corrotto: ' + rel)
    restore_files(profile, backup, record)
    return {'status': 'restored', 'backup': str(backup)}


def fetch(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme == 'https':
        with urllib.request.urlopen(url, timeout=20) as response:
            if urllib.parse.urlparse(response.url).scheme != 'https':
                raise ValueError('Redirect non HTTPS')
            data = response.read(MAX_BYTES + 1)
    elif not parsed.scheme:
        data = Path(url).read_bytes()
    else:
        raise ValueError('Usare un percorso locale o HTTPS')
    if len(data) > MAX_BYTES:
        raise ValueError('Download troppo grande')
    return data


def sync(config_path):
    config = json.loads(Path(config_path).read_text())
    source = config['channel']
    channel = json.loads(fetch(source))
    name = channel['archive']
    if PurePosixPath(name).name != name or '\\' in name or not re.fullmatch(r'fede-modern-\d+\.\d+\.\d+\.zip', name):
        raise ValueError('Nome release non valido')
    location = urllib.parse.urljoin(source, name) if source.startswith('https://') else str(Path(source).parent / name)
    data = fetch(location)
    if digest(data) != channel['sha256']:
        raise ValueError('Checksum del canale non valido')
    initial = config.get('adopt_initial', False) and not (Path(config['profile']) / STATE).exists()
    if initial:
        if set(config.get('initial_files', {})) != ALLOWED:
            raise ValueError('Manca la baseline locale per la prima installazione')
        for rel, expected in config['initial_files'].items():
            target = safe_target(Path(config['profile']), rel)
            actual = digest(target.read_bytes()) if target.exists() else None
            if actual != expected:
                raise ValueError('File cambiato dopo la preparazione: ' + rel)
    with tempfile.TemporaryDirectory(prefix='fede-modern-download-') as tmp:
        archive = Path(tmp) / name
        archive.write_bytes(data)
        return install(archive, config['profile'], initial)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    cmd = commands.add_parser('install')
    cmd.add_argument('archive', type=Path)
    cmd.add_argument('--profile', required=True, type=Path)
    cmd.add_argument('--adopt', action='store_true', help='Backup e adozione iniziale dei soli file del pacchetto')
    cmd.add_argument('--dry-run', action='store_true')
    cmd = commands.add_parser('rollback')
    cmd.add_argument('--profile', required=True, type=Path)
    cmd.add_argument('--backup', required=True, type=Path)
    cmd = commands.add_parser('sync')
    cmd.add_argument('--config', required=True, type=Path)
    commands.add_parser('profiles')
    args = parser.parse_args()
    try:
        if args.command == 'install':
            result = install(args.archive, args.profile, args.adopt, args.dry_run)
        elif args.command == 'rollback':
            result = rollback(args.profile, args.backup)
        elif args.command == 'sync':
            result = sync(args.config)
        else:
            result = []
            for base in [Path.home() / '.thunderbird', Path.home() / '.var/app/org.mozilla.Thunderbird/.thunderbird', Path.home() / 'Library/Thunderbird']:
                ini = configparser.ConfigParser()
                ini.read(base / 'profiles.ini')
                for section in ini.sections():
                    if section.startswith('Profile') and ini.has_option(section, 'Path'):
                        path = Path(ini[section]['Path'])
                        if ini.getboolean(section, 'IsRelative', fallback=True):
                            path = base / path
                        result.append(str(path))
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({'status': 'error', 'reason': str(error)}, ensure_ascii=False))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
