#!/usr/bin/env python3
"""Windows setup using an existing Python installation and Thunderbird profile."""
import sys
from setup import setup, default_channel
from updater import discover_profiles


def main():
    if sys.platform != 'win32':
        raise SystemExit('Questo installer e riservato a Windows.')
    profiles = discover_profiles()
    if not profiles:
        raise SystemExit('Avvia Thunderbird e chiudilo prima di installare le personalizzazioni.')
    print('Fede Modern per Windows: installer beta, verifica grafica ancora necessaria.')
    print('I file modificati vengono salvati in un backup nel profilo.')
    for index, profile in enumerate(profiles, 1):
        print(f'{index}. {profile}')
    choice = input('Numero del profilo (Invio annulla): ').strip()
    if not choice:
        return
    if not choice.isdigit() or not 1 <= int(choice) <= len(profiles):
        raise SystemExit('Scelta non valida.')
    profile = profiles[int(choice) - 1]
    if input(f'Installare su {profile.name} e attivare gli aggiornamenti ogni 15 minuti? [s/N] ').strip().lower() != 's':
        return
    result = setup(profile, default_channel(), enable=True)
    print(result)
    if result['status'] == 'deferred':
        print('Chiudi Thunderbird. Le personalizzazioni saranno applicate al prossimo controllo.')
    else:
        print('Personalizzazioni installate. Apri Thunderbird per verificarle.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
