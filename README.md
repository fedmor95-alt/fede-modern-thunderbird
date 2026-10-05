# Fede Modern — pacchetto personalizzazioni desktop

Pacchetto indipendente, non un fork né una distribuzione ufficiale Thunderbird.
Release iniziale 1.0.6, verificata su Thunderbird **156** Linux. Il controllo
blocca altre versioni fino a verifica esplicita; aggiornare Thunderbird con il
normale canale del sistema. Non disabilitare gli aggiornamenti di sicurezza.

## Contenuto

- Tema chiaro/scuro, compositore e ricerca unica.
- Sidebar unificata; alias visivi Personale/Lavoro per account denominati con
  indirizzi email, indirizzi completi nei tooltip, nomi reali immutati.
- Account e cartelle raccolti in una sezione espandibile, stati nativi conservati.
- Un solo Scrivi quando il comando globale è visibile. Risposta intelligente
  originale con Rispondi/Rispondi a tutti/Rispondi alla lista nel relativo menu.
- Snooze e Swipe 1.0.6: sinistra archivia, destra apre le opzioni Posticipa;
  menu contestuale e azione del messaggio. Le scadenze rimangono locali.
- Tema giorno/notte 1.0.0: opzioni e orari già impostati restano nel profilo.

Non contiene account, password, OAuth, email, database, storage snooze o font
Apple. Usa SF Pro se già installato legittimamente nel sistema; altrimenti il
font di sistema. Quindi la tipografia può differire su un dispositivo senza SF Pro.
I due add-on sono privilegiati: installare soltanto release fidate.

## Prima installazione

Estrarre il kit in una directory privata stabile, non dentro il profilo di posta.
Servono Python 3.9+, Linux con systemd utente, pgrep e un Thunderbird già avviato
almeno una volta. Non occorre root. Account e login si configurano separatamente.

```bash
python3 updater.py profiles
python3 updater.py install releases/fede-modern-1.0.6.zip --profile /percorso/del/profilo --adopt --dry-run
python3 setup.py --profile /percorso/del/profilo --enable
```

`--adopt` significa accettare, **dopo la verifica**, il backup e la sostituzione
dei soli dieci file elencati in `updater.py`. Non puntare al profilo sbagliato.
Il setup registra gli hash iniziali: se un file cambia prima dell'installazione,
si ferma senza sovrascriverlo. `user.js` conserva il contenuto precedente e riceve
solo due preferenze: abilita CSS personalizzato e vista a schede. Le preferenze
del mittente, gli account e lo storage degli add-on non vengono modificati.

Il controllo locale gira ogni 15 minuti. Con Thunderbird aperto restituisce
`deferred`: niente chiusure forzate, bozze o dati toccati. Chiudere Thunderbird,
attendere il controllo oppure eseguire:

```bash
systemctl --user start fede-modern-update.service
```

Poi riaprire Thunderbird. Alla prima installazione potrebbe essere necessario
abilitare i due componenti dal gestore delle estensioni; non si disattivano
globalmente le protezioni di installazione.

## Pubblicare una modifica su entrambi i computer

1. Modificare i sorgenti e aggiornare `payload/`; incrementare versione add-on
   quando cambia codice XPI. Eseguire test e prova nel profilo fittizio.
2. Creare una **nuova** release, senza riutilizzare un numero:
   `python3 build.py --version 1.0.7`.
3. Il canale locale `releases/stable.json` punta alla nuova release. Il servizio
   del computer principale la applica automaticamente quando Thunderbird chiude.
4. Distribuire via SSH con `python3 deploy.py --host UTENTE@HOST --remote-home
   /home/UTENTE --profile /percorso/remoto/profilo --enable`. Il comando manda
   soltanto archivio, manifest e updater; non sincronizza il profilo. Il servizio
   remoto installerà la stessa versione quando possibile.

Il push SSH richiede le macchine raggiungibili e una chiave host già conosciuta.
`deploy.py` non abilita VPN né installa Thunderbird. Se esistono più profili,
li elenca e richiede una scelta esplicita invece di scegliere a caso.
Senza una distribuzione riuscita verso Steam, il timer locale di Steam non può
inventarsi una release nuova: il canale deve prima esservi trasferito.
Si può successivamente usare un canale HTTPS comune fidato in `config.json`
per rendere il download indipendente dal computer principale. Non ancora ospitato.
SHA-256 rileva corruzioni, **non sostituisce** la fiducia nell'host HTTPS o SSH.

## Backup e ripristino

Ogni modifica crea `fede-modern-backups/DATA-ID` nel profilo, contenente soltanto
i file sostituiti e lo stato precedente. Non sono copie della posta. Non vengono
cancellati automaticamente. Per fermare gli aggiornamenti e ripristinare:

```bash
systemctl --user disable --now fede-modern-update.timer
python3 updater.py rollback --profile /percorso/profilo --backup /percorso/profilo/fede-modern-backups/DATA-ID
```

Ripristino a Thunderbird chiuso. Se un file è stato modificato dopo l'installazione,
il rollback si ferma per preservare quella modifica. Lo storage delle estensioni
non viene ripristinato, copiato né cancellato. Le impostazioni native della sidebar
si possono sempre cambiare dal menu Cartelle.

## Licenze / limiti

Il tema deriva in parte da modern-spark (MIT, avviso in `licenses/` e nel payload).
Snooze deriva da Contextual Dynamics Laboratory (MIT, incluso nello XPI). Le altre
risorse e parti vanno sottoposte ad audit completo prima di una pubblicazione
commerciale. Il kit attuale è preparato per uso personale: nessun marchio ufficiale
o font proprietario viene rivenduto. Non include sincronizzazione snooze tra PC,
con Gmail, né supporto mobile.
