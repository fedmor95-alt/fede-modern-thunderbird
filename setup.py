#!/usr/bin/env python3
"""Configure this Linux user's customization updater (no root required)."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

from updater import ALLOWED, atomic, digest, safe_target, profile_version, read_release, sync

ROOT = Path(__file__).resolve().parent


def setup(profile, channel, enable=False):
    profile = profile.expanduser().resolve(strict=True)
    if not (profile / 'prefs.js').exists():
        raise ValueError('Profilo Thunderbird non valido')
    profile_version(profile)
    # Local deployment channels are private files, not a public upload.
    if not channel.startswith('https://'):
        channel = str(Path(channel).expanduser().resolve(strict=True))
        release = json.loads(Path(channel).read_text())
        manifest, _ = read_release(Path(channel).parent / release['archive'])
        major = profile_version(profile)
        if not manifest['compatibility']['min_major'] <= major <= manifest['compatibility']['max_major']:
            raise ValueError(f'Thunderbird {major}: pacchetto non verificato, setup non eseguito')
    config_dir = Path.home() / '.config/fede-modern'
    runtime = Path.home() / '.local/share/fede-modern'
    units = Path.home() / '.config/systemd/user'
    config = {'profile': str(profile), 'channel': channel, 'adopt_initial': True,
              'initial_files': {rel: digest(safe_target(profile, rel).read_bytes()) if safe_target(profile, rel).exists() else None for rel in sorted(ALLOWED)}}
    config_path = config_dir / 'config.json'
    if config_path.exists():
        previous = json.loads(config_path.read_text())
        if previous['profile'] != str(profile):
            raise ValueError('Updater già associato a un altro profilo; non sovrascritto')
        # Never silently accept edits made after an earlier setup.
        config['initial_files'] = previous['initial_files']
    for path in [config_dir, runtime, units]:
        if path.is_symlink():
            raise ValueError('Directory di installazione non valida')
        path.mkdir(parents=True, exist_ok=True)
    atomic(runtime / 'updater.py', (ROOT / 'updater.py').read_bytes())
    atomic(config_path, (json.dumps(config, indent=2) + '\n').encode())
    service = '''[Unit]
Description=Aggiornamento personalizzazioni Fede Modern per Thunderbird

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 "%h/.local/share/fede-modern/updater.py" sync --config "%h/.config/fede-modern/config.json"
NoNewPrivileges=yes
UMask=0077
'''
    timer = '''[Unit]
Description=Controlla il pacchetto Thunderbird ogni 15 minuti

[Timer]
OnStartupSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
'''
    atomic(units / 'fede-modern-update.service', service.encode())
    atomic(units / 'fede-modern-update.timer', timer.encode())
    if enable:
        subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', '--user', 'enable', '--now', 'fede-modern-update.timer'], check=True)
    return sync(config_path)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--profile', required=True, type=Path)
    p.add_argument('--channel', default=str(ROOT / 'releases/stable.json'))
    p.add_argument('--enable', action='store_true')
    args = p.parse_args()
    try:
        print(json.dumps(setup(args.profile, args.channel, args.enable), ensure_ascii=False, indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(json.dumps({'status': 'error', 'reason': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
