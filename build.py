#!/usr/bin/env python3
"""Build a versioned customization-only release. Never reads a user profile."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from updater import ALLOWED, atomic
from build_calendar_addon import build as build_theme_calendar

ROOT = Path(__file__).resolve().parent


def build(version, destination):
    build_theme_calendar(ROOT / 'payload/extensions/fede-day-night@local.xpi')
    payload = {name: (ROOT / 'payload' / name).read_bytes() for name in sorted(ALLOWED)}
    manifest = {'product': 'fede-modern', 'version': version,
                'compatibility': {'min_major': 156, 'max_major': 157},
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()}}
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / ('fede-modern-' + version + '.zip')
    if output.exists():
        raise ValueError('Release immutabile: usare una nuova versione o una diversa cartella di staging')
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('release.json', json.dumps(manifest, indent=2) + '\n')
        for name, data in payload.items():
            z.writestr('payload/' + name, data)
    channel = {'version': version, 'archive': output.name,
               'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
    atomic(destination / 'stable.json', (json.dumps(channel, indent=2) + '\n').encode())
    print(output)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'releases')
    args = parser.parse_args()
    build(args.version, args.output)
