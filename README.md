# Fede Modern — pacchetto personalizzazioni desktop

[Scarica l’ultima release per Linux o macOS beta](https://github.com/fedmor95-alt/fede-modern-thunderbird/releases/latest).

Canale condiviso: `https://github.com/fedmor95-alt/fede-modern-thunderbird/releases/latest/download/stable.json`.

Pacchetto indipendente, non un fork né una distribuzione ufficiale Thunderbird.
Release 1.0.8: canale pubblico degli aggiornamenti e pubblicazione automatica.
Include il calendario e l'editor eventi della 1.0.7; contatori
account unificati esclusivamente non letti. Verificata su Thunderbird **156–157**
Linux (Fedora e SteamOS). Supporto installer **macOS beta**, non ancora provato
su un Mac reale; non è un DMG né una build modificata di Thunderbird. Il controllo
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
Servono Python 3.9+, Linux con systemd utente (o macOS con launchd), pgrep e un Thunderbird già avviato
almeno una volta. Non occorre root. Account e login si configurano separatamente.

```bash
python3 updater.py profiles
python3 updater.py install releases/fede-modern-1.0.8.zip --profile /percorso/del/profilo --adopt --dry-run
python3 setup.py --profile /percorso/del/profilo --enable
```

`--adopt` significa accettare, **dopo la verifica**, il backup e la sostituzione
dei soli undici file elencati in `updater.py`. Non puntare al profilo sbagliato.
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

## Aggiornamenti automatici da GitHub

I kit pubblici includono `update-channel.txt`: `setup.py` e l'installer Mac
configurano automaticamente il canale HTTPS della stessa repository.
Ogni dispositivo lo controlla ogni 15 minuti. Le modifiche si applicano quando
Thunderbird è chiuso e diventano visibili alla successiva apertura.
Non occorre che Fedbook o Steam siano accesi contemporaneamente.

Per pubblicare una modifica dalla pagina GitHub:

1. Modifica i file in `payload/`. Se cambia un add-on, ricostruisci e aggiorna
   anche il relativo XPI e incrementa la sua versione.
2. Incrementa `VERSION`, per esempio da `1.0.8` a `1.0.9`, e salva su `main`.
3. GitHub Actions esegue i test Linux/Mac, costruisce gli ZIP, carica tutti gli
   asset in una bozza e poi pubblica la release completa come ultima stabile.
4. I dispositivi ricevono la nuova versione al controllo successivo disponibile.

Una modifica senza incremento di `VERSION` esegue i test, ma non sovrascrive una
release esistente. Il numero deve essere sempre nuovo e maggiore del precedente.
Un test fallito ferma la pubblicazione. Le prove su macOS in Actions riguardano
l'installer: il design e il trackpad Mac rimangono beta finché verificati su Mac.

I font proprietari non sono distribuiti. Account, posta e scadenze snooze locali
rimangono sui dispositivi: questo canale distribuisce le personalizzazioni.

Gli aggiornamenti dell'app Thunderbird continuano attraverso il suo canale
abituale; le versioni del pacchetto dichiarano quali versioni principali sono
state verificate. La 1.0.8 accetta Thunderbird 156–157.

## Distribuzione locale alternativa

1. Modificare i sorgenti e aggiornare `payload/`; incrementare versione add-on
   quando cambia codice XPI. Eseguire test e prova nel profilo fittizio.
2. Creare una **nuova** release, senza riutilizzare un numero:
   `python3 build.py --version 1.0.9`.
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
I kit pubblici usano il canale HTTPS comune; il push SSH rimane disponibile
per distribuzioni private o di prova.
SHA-256 rileva corruzioni, **non sostituisce** la fiducia nell'host HTTPS o SSH.

## Backup e ripristino

### macOS beta

Installa Thunderbird ufficiale e avvialo una volta; configura gli account
separatamente. Occorre Python 3.9+ installato (non è garantito che macOS lo includa).
Estrai il kit in una cartella stabile. Avvia `Installa-Mac.command`, oppure da
Terminale nella cartella estratta: `python3 install_macos.py`. Seleziona il
profilo esplicitamente. Non disabilitare Gatekeeper per usare il kit.

Il profilo viene rilevato da `~/Library/Thunderbird/profiles.ini`.
L'updater e la configurazione sono in `~/Library/Application Support/Fede Modern`;
il controllo ogni 15 minuti in `~/Library/LaunchAgents/org.fedemodern.update.plist`.
Le prove automatiche verificano percorsi, plist e blocco a Thunderbird aperto;
resa grafica, trackpad, permessi e avvio launchd necessitano ancora prova su Mac.
Per fermarlo: `launchctl bootout gui/$(id -u)/org.fedemodern.update`.
Per controllare subito: `python3 updater.py sync --config "$HOME/Library/Application Support/Fede Modern/config.json"`.
Il rollback sottostante è identico su Mac, a Thunderbird chiuso.

### Download pubblico e canale comune

Non serve un fork di Thunderbird. Crea un repository pubblico del solo pacchetto,
pubblica una GitHub Release e allega i kit Linux/Mac beta, i checksum,
`fede-modern-1.0.8.zip` e `stable.json`. Un sito può avere due pulsanti che puntano
agli asset della release. Non pubblicare il profilo, le cartelle QA, le
configurazioni personali, gli account o credenziali. Il builder usa un elenco
chiuso di file e non legge il profilo.

Esempio di canale comune, da usare solo dopo che gli asset esistono realmente:
`https://github.com/fedmor95-alt/fede-modern-thunderbird/releases/latest/download/stable.json`.
Esegui `python3 setup.py --profile PERCORSO --channel URL --enable` su ciascuna
macchina. Pubblica insieme manifest e archivio di ogni nuova release stabile:
ogni macchina scaricherà le stesse personalizzazioni a Thunderbird chiuso,
indipendentemente da Tailscale o dall'accensione del computer principale.
Prima del primo passaggio di formato dell'installer, aggiornare anche i suoi
script: il timer aggiorna il payload, **non esegue auto-aggiornamenti di sé stesso**.
Il workflow `.github/workflows/release.yml` automatizza questa pubblicazione.

Documentazione: [asset delle release GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases),
[LaunchAgents Apple](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

### Ripristino

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
