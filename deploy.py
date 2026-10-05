#!/usr/bin/env python3
"""Push ONE trusted customization release over existing SSH. No profile copy.

Never starts Thunderbird, installs an app, enables Tailscale, or touches Drive.
Run once after each tested release. The target applies it when Thunderbird closes.
"""
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess

ROOT = Path(__file__).resolve().parent


def deploy(host, remote_home, remote_profile=None, enable=False):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+', host):
        raise ValueError('Specificare utente@host senza opzioni SSH')
    if not re.fullmatch(r'/home/[A-Za-z0-9_.-]+', remote_home):
        raise ValueError('Home remota non valida')
    channel = json.loads((ROOT / 'releases/stable.json').read_text())
    if not re.fullmatch(r'\d+\.\d+\.\d+', channel['version']):
        raise ValueError('Versione non valida')
    if channel['archive'] != 'fede-modern-' + channel['version'] + '.zip':
        raise ValueError('Archivio non valido')
    options = ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8']
    def ssh(command):
        return subprocess.run(['ssh', *options, host, command], check=True, text=True, capture_output=True, timeout=40).stdout
    # Verify reachability before copying any files. No account data is read.
    ssh('test -x /usr/bin/python3')
    destination = remote_home + '/.local/share/fede-modern/distribution'
    ssh('mkdir -p ' + shlex.quote(destination + '/releases'))
    for local, remote in [(ROOT / name, destination + '/' + name) for name in ['updater.py', 'setup.py']]:
        subprocess.run(['scp', *options, str(local), host + ':' + remote], check=True, timeout=40)
    archive = ROOT / 'releases' / channel['archive']
    subprocess.run(['scp', *options, str(archive), host + ':' + destination + '/releases/' + archive.name], check=True, timeout=40)
    # Publish the channel only after the corresponding archive is fully copied.
    subprocess.run(['scp', *options, str(ROOT / 'releases/stable.json'), host + ':' + destination + '/releases/stable.next.json'], check=True, timeout=40)
    ssh('mv ' + shlex.quote(destination + '/releases/stable.next.json') + ' ' + shlex.quote(destination + '/releases/stable.json'))
    if remote_profile is None:
        profiles = json.loads(ssh('/usr/bin/python3 ' + shlex.quote(destination + '/updater.py') + ' profiles'))
        if len(profiles) != 1:
            return {'status': 'staged', 'reason': 'Selezionare il profilo remoto tra quelli rilevati', 'profiles': profiles}
        remote_profile = profiles[0]
    command = ['/usr/bin/python3', destination + '/setup.py', '--profile', remote_profile, '--channel', destination + '/releases/stable.json']
    if enable:
        command.append('--enable')
    return json.loads(ssh(shlex.join(command)))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host', required=True)
    p.add_argument('--remote-home', required=True)
    p.add_argument('--profile')
    p.add_argument('--enable', action='store_true')
    args = p.parse_args()
    try:
        print(json.dumps(deploy(args.host, args.remote_home, args.profile, args.enable), ensure_ascii=False, indent=2))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'unreachable-or-error', 'reason': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
