#!/usr/bin/env python3
"""Interactive macOS beta setup. Accounts and credentials are never imported."""
import configparser
from pathlib import Path
import sys
from setup import setup, default_channel


def main():
    if sys.platform != 'darwin':
        raise SystemExit('Questo installer è riservato a macOS.')
    base = Path.home() / 'Library/Thunderbird'
    ini = configparser.ConfigParser()
    ini.read(base / 'profiles.ini')
    profiles = []
    for section in ini.sections():
        if section.startswith('Profile') and ini.has_option(section, 'Path'):
            path = Path(ini[section]['Path'])
            profiles.append(base / path if ini.getboolean(section, 'IsRelative', fallback=True) else path)
    if not profiles:
        raise SystemExit('Avvia Thunderbird, configura gli account e chiudilo prima di installare il tema.')
    print('Fede Modern per Mac — BETA, non ancora verificata su hardware macOS.')
    print('Aggiorna solo il tema e gli add-on. Crea backup; non copia account o messaggi.')
    for index, profile in enumerate(profiles, 1):
        print(f'{index}. {profile}')
    value = input('Numero del profilo da personalizzare (Invio annulla): ').strip()
    if not value:
        return
    if not value.isdigit() or not 1 <= int(value) <= len(profiles):
        raise SystemExit('Scelta non valida; nessuna modifica.')
    profile = profiles[int(value) - 1]
    if input(f'Installare sul profilo {profile.name} e controllare aggiornamenti ogni 15 minuti? [s/N] ').strip().lower() != 's':
        return
    result = setup(profile, default_channel(), True)
    print(result)
    print('Il canale degli aggiornamenti è configurato. Le modifiche si applicano a Thunderbird chiuso.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
