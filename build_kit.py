#!/usr/bin/env python3
"""Build downloadable kits from an explicit public-safe source allowlist."""
import hashlib
import json
import re
from pathlib import Path
import zipfile
from updater import ALLOWED

ROOT = Path(__file__).resolve().parent


def build_kits(destination, repository=None, release_dir=None):
    release_dir = release_dir or ROOT / 'releases'
    channel = json.loads((release_dir / 'stable.json').read_text())
    if repository and not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Repository non valido')
    version = channel['version']
    common = ['README.md', 'LICENSE', 'VERSION', 'build.py', 'build_kit.py', 'publish.py', 'updater.py', 'setup.py', 'deploy.py',
              'install_macos.py', 'Installa-Mac.command',
              'test_updater.py', 'test_macos.py', 'test_distribution.py', 'licenses/modern-spark-MIT.txt', 'licenses/snooze-MIT.txt',
              'releases/stable.json', 'releases/' + channel['archive']]
    common += ['payload/' + name for name in sorted(ALLOWED)]
    destination.mkdir(parents=True, exist_ok=True)
    checksums = []
    for platform in ['linux', 'mac-beta']:
        target = destination / f'fede-modern-{platform}-{version}.zip'
        if target.exists():
            raise ValueError('Kit esistente: usare una nuova destinazione/versione')
        names = common
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name in names:
                info = zipfile.ZipInfo('fede-modern-' + version + '/' + name)
                info.external_attr = (0o100755 if name.endswith('.command') else 0o100644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                source = release_dir / Path(name).name if name.startswith('releases/') else ROOT / name
                archive.writestr(info, source.read_bytes())
            if repository:
                archive.writestr('fede-modern-' + version + '/update-channel.txt',
                                 f'https://github.com/{repository}/releases/latest/download/stable.json\n')
        checksums.append(hashlib.sha256(target.read_bytes()).hexdigest() + '  ' + target.name)
        print(target)
    (destination / f'SHA256SUMS-{version}.txt').write_text('\n'.join(checksums) + '\n')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--repository')
    args = parser.parse_args()
    build_kits(args.output, args.repository)
