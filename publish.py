#!/usr/bin/env python3
"""Publish an immutable release via authenticated official GitHub CLI."""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

from build import build
from build_kit import build_kits

ROOT = Path(__file__).resolve().parent


def publish(repository, commit='main'):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Specificare OWNER/REPO')
    version = (ROOT / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('VERSION deve contenere un numero come 1.0.8')
    tag = 'v' + version
    found = subprocess.run(['gh', 'api', f'repos/{repository}/releases/tags/{tag}'], text=True, capture_output=True)
    if found.returncode == 0:
        release = json.loads(found.stdout)
        if release.get('draft'):
            raise ValueError('Esiste già una bozza per questa versione; controllarla prima di riprovare')
        print('Release già pubblicata: ' + release['html_url'])
        return
    if 'HTTP 404' not in found.stderr:
        raise ValueError('Impossibile verificare le release GitHub: ' + found.stderr.strip())
    latest = subprocess.run(['gh', 'api', f'repos/{repository}/releases/latest'], text=True, capture_output=True)
    if latest.returncode == 0:
        previous = json.loads(latest.stdout)['tag_name']
        if not re.fullmatch(r'v\d+\.\d+\.\d+', previous):
            raise ValueError('Ultima release con versione non riconosciuta; controllarla manualmente')
        if tuple(map(int, version.split('.'))) <= tuple(map(int, previous[1:].split('.'))):
            raise ValueError('VERSION deve essere maggiore dell’ultima release pubblicata')
    elif 'HTTP 404' not in latest.stderr:
        raise ValueError('Impossibile verificare l’ultima release: ' + latest.stderr.strip())
    with tempfile.TemporaryDirectory(prefix='fede-modern-publish-') as temporary:
        destination = Path(temporary)
        archive = build(version, destination / 'releases')
        # Kits and release assets are built from exactly the same payload.
        build_kits(destination, repository=repository, release_dir=archive.parent)
        assets = [archive, archive.parent / 'stable.json'] + sorted(destination.glob('*.zip'))
        checksum = destination / 'SHA256SUMS.txt'
        checksum.write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n' for path in assets))
        assets.append(checksum)
        notes = destination / 'release-notes.txt'
        notes.write_text(
            f'Fede Modern {version}: personalizzazioni Thunderbird per Linux e macOS beta.\n\n'
            'Tema chiaro/scuro, posta, compositore, calendario, Snooze e Swipe.\n'
            'Il kit Mac resta beta: non ancora verificato graficamente su hardware macOS.\n'
            'Account, messaggi, password e scadenze snooze personali restano sui dispositivi.\n\n'
            'Gli aggiornamenti controllano il canale pubblico ogni 15 minuti e vengono applicati a Thunderbird chiuso.\n'
            f'Canale: https://github.com/{repository}/releases/latest/download/stable.json\n')
        subprocess.run(['gh', 'release', 'create', tag, '--repo', repository, '--target', commit,
                        '--draft', '--title', 'Fede Modern ' + version, '--notes-file', str(notes)], check=True)
        # Users see the release only after every asset is uploaded.
        subprocess.run(['gh', 'release', 'upload', tag, '--repo', repository, *map(str, assets)], check=True)
        subprocess.run(['gh', 'release', 'edit', tag, '--repo', repository, '--draft=false', '--latest'], check=True)
        print(f'https://github.com/{repository}/releases/tag/{tag}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--commit', default='main')
    args = parser.parse_args()
    publish(args.repository, args.commit)
