#!/usr/bin/env python3
"""Configure a per-user updater on Linux, macOS or Windows."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import os
import plistlib
from datetime import datetime, timedelta
import xml.etree.ElementTree as ET

from updater import ALLOWED, atomic, digest, safe_target, profile_version, read_release, sync, is_redirect

ROOT = Path(__file__).resolve().parent


def default_channel():
    bundled = ROOT / 'update-channel.txt'
    if bundled.exists():
        channel = bundled.read_text().strip()
        if not channel.startswith('https://github.com/') or not channel.endswith('/releases/latest/download/stable.json'):
            raise ValueError('Canale pubblico del kit non valido')
        return channel
    return str(ROOT / 'releases/stable.json')


def locations():
    if sys.platform == 'win32':
        if not os.environ.get('LOCALAPPDATA'):
            raise ValueError('Percorso LOCALAPPDATA di Windows non disponibile')
        runtime = Path(os.environ['LOCALAPPDATA']) / 'Fede Modern'
        return runtime, runtime, runtime
    if sys.platform == 'darwin':
        runtime = Path.home() / 'Library/Application Support/Fede Modern'
        return runtime, runtime, Path.home() / 'Library/LaunchAgents'
    return (Path.home() / '.config/fede-modern', Path.home() / '.local/share/fede-modern',
            Path.home() / '.config/systemd/user')


def launch_agent(runtime, config_path):
    return plistlib.dumps({
        'Label': 'org.fedemodern.update',
        'ProgramArguments': [sys.executable, str(runtime / 'updater.py'), 'sync', '--config', str(config_path)],
        'RunAtLoad': True, 'StartInterval': 900, 'ProcessType': 'Background',
        'StandardOutPath': str(runtime / 'update.log'),
        'StandardErrorPath': str(runtime / 'update-error.log'),
        'Umask': 0o077,
    })


def windows_task(runtime, config_path, user):
    """Task uses the logged-in user's token; no password or administrator role."""
    task = ET.Element('Task', version='1.2', xmlns='http://schemas.microsoft.com/windows/2004/02/mit/task')
    registration = ET.SubElement(task, 'RegistrationInfo')
    ET.SubElement(registration, 'Description').text = 'Aggiornamenti Fede Modern per Thunderbird ogni 15 minuti'
    triggers = ET.SubElement(task, 'Triggers')
    trigger = ET.SubElement(triggers, 'TimeTrigger')
    repetition = ET.SubElement(trigger, 'Repetition')
    ET.SubElement(repetition, 'Interval').text = 'PT15M'
    ET.SubElement(repetition, 'StopAtDurationEnd').text = 'false'
    ET.SubElement(trigger, 'StartBoundary').text = (datetime.now() + timedelta(minutes=15)).isoformat(timespec='seconds')
    ET.SubElement(trigger, 'Enabled').text = 'true'
    principals = ET.SubElement(task, 'Principals')
    principal = ET.SubElement(principals, 'Principal', id='CurrentUser')
    ET.SubElement(principal, 'UserId').text = user
    ET.SubElement(principal, 'LogonType').text = 'InteractiveToken'
    ET.SubElement(principal, 'RunLevel').text = 'LeastPrivilege'
    settings = ET.SubElement(task, 'Settings')
    for name, value in [('MultipleInstancesPolicy', 'IgnoreNew'),
                        ('DisallowStartIfOnBatteries', 'false'),
                        ('StopIfGoingOnBatteries', 'false'),
                        ('StartWhenAvailable', 'true'), ('ExecutionTimeLimit', 'PT5M')]:
        ET.SubElement(settings, name).text = value
    action = ET.SubElement(ET.SubElement(task, 'Actions', Context='CurrentUser'), 'Exec')
    windowless = Path(sys.executable).with_name('pythonw.exe')
    executable = windowless if windowless.is_file() else Path(sys.executable)
    ET.SubElement(action, 'Command').text = str(executable)
    ET.SubElement(action, 'Arguments').text = subprocess.list2cmdline(
        [str(runtime / 'updater.py'), 'sync', '--config', str(config_path)])
    ET.SubElement(action, 'WorkingDirectory').text = str(runtime)
    return ET.tostring(task, encoding='utf-16', xml_declaration=True)


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
    config_dir, runtime, units = locations()
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
        if is_redirect(path):
            raise ValueError('Directory di installazione non valida')
        path.mkdir(parents=True, exist_ok=True)
    atomic(runtime / 'updater.py', (ROOT / 'updater.py').read_bytes())
    atomic(config_path, (json.dumps(config, indent=2) + '\n').encode())
    if sys.platform == 'win32':
        user = subprocess.run(['whoami'], capture_output=True, text=True, check=True).stdout.strip()
        if not user:
            raise ValueError('Impossibile identificare l’utente Windows')
        task_name = 'FedeModern-' + digest(user.casefold().encode())[:12]
        task_file = runtime / 'update-task.xml'
        atomic(task_file, windows_task(runtime, config_path, user))
        # Verify a first installation before enabling repeated writes.
        result = sync(config_path)
        if enable:
            subprocess.run(['schtasks', '/Create', '/TN', task_name, '/XML', str(task_file), '/F'], check=True)
        return dict(result, task=task_name, updates_enabled=enable)
    if sys.platform == 'darwin':
        agent = units / 'org.fedemodern.update.plist'
        atomic(agent, launch_agent(runtime, config_path))
        if enable:
            domain = 'gui/' + str(os.getuid())
            subprocess.run(['launchctl', 'bootout', domain + '/org.fedemodern.update'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            subprocess.run(['launchctl', 'bootstrap', domain, str(agent)], check=True)
        return sync(config_path)
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
    p.add_argument('--channel', default=default_channel())
    p.add_argument('--enable', action='store_true')
    args = p.parse_args()
    try:
        print(json.dumps(setup(args.profile, args.channel, args.enable), ensure_ascii=False, indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(json.dumps({'status': 'error', 'reason': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
