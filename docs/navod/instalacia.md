# Inštalácia SkladPulz u zákazníka

Postup pre technika (#8). SkladPulz je jedna aplikácia (Node.js) s vlastnou databázou v jednom súbore. Beží na serveri v sieti skladu, najlepšie na tom istom serveri ako ONIX. Stanice (PC, tablet, Android terminál) potrebujú len prehliadač.

## 1. Pred inštaláciou

- Odpovede na otázky zo zadania (#1, sekcie 6 a 7) a z `docs/otazky.md`, hlavne: zmeny, ktoré DL sú aktívne, druhy DL.
- Prístup na server (RDP) s právom inštalovať programy a otvoriť port vo firewalle.
- Prístup k ONIX DB (PostgreSQL) ako správca, na založenie view a používateľa len na čítanie.
- Zoznam staníc (názov, predvolená činnosť) a skladníkov (mená).

## 2. Server

1. Nainštalujte **Node.js 22 LTS** (22.18 alebo novší) z nodejs.org, 64-bit, s predvolenými voľbami. Overte v príkazovom riadku: `node -v`.
2. Skopírujte priečinok aplikácie, napr. do `C:\SkladPulz`, a v ňom spustite `npm ci --omit=dev` a potom `npm run build`.
   - `npm run build` potrebuje TypeScript; ak inštalujete bez dev závislostí, skopírujte hotový priečinok `public\js` z vývojového PC.
3. Skopírujte `config.example.json` na `config.json` a upravte (nižšie).
4. Prvé spustenie na skúšku: `node --disable-warning=ExperimentalWarning src\main.ts`. V prehliadači na serveri otvorte `http://localhost:3000`.

## 3. Konfigurácia (`config.json`)

| Kľúč | Čo nastaviť |
|---|---|
| `port` | port aplikácie, predvolene 3000 |
| `dbPath` | kde je databáza meraní, napr. `data/skladpulz.db` (zálohovať!) |
| `shifts` | zmeny skladu, napr. `{ "name": "Ranná", "from": "06:00", "to": "14:00" }` |
| `autoCloseGraceMin` | koľko minút po konci zmeny sa neukončené záznamy uzavrú |
| `limits` | hranice podozrivých záznamov v sekundách (`shortSeconds` 20, `longSeconds` 7200) |
| `repeatScanEnds` | `true`, ak opakované pípnutie DL má ukončiť záznam (rozhodne zákazník) |
| `onix.connectionString` | `postgres://skladpulz_ro:HESLO@server:5432/databaza` |
| `onix.activeStates`, `onix.documentTypes`, `onix.daysBack` | ktoré DL sa sťahujú (prázdne = všetky) |
| `managers` | prihlasovanie vedúcich, heslo zahashujte príkazom `npm run hash-password` |
| `sessionSecret` | dlhý náhodný reťazec (aspoň 32 znakov) |
| `email` | SMTP a príjemcovia denného súhrnu |
| `baseUrl` | adresa, na ktorej je SkladPulz v sieti (do odkazov v e-mailoch) |

Pri chybe v konfigurácii aplikácia nenaštartuje a vypíše, čo je zle.

### Denný súhrn e-mailom (`email`)

| Kľúč | Čo nastaviť |
|---|---|
| `email.enabled` | `true` zapne odosielanie (kontrola každých 5 minút) |
| `email.recipients` | zoznam adries, napr. `["veduci@firma.sk"]` |
| `email.attachExcel` | `true` pridá k e-mailu Excel dňa |
| `email.delayMin` | koľko minút po konci poslednej zmeny sa súhrn pošle (predvolene 15) |
| `email.smtp` | `host`, `port`, `secure` (`true` pre port 465), `user`, `password`, `from` (napr. `"SkladPulz <skladpulz@firma.sk>"`) |

Súhrn sa pošle raz za deň; zmena končiaca po polnoci patrí do dňa, v ktorom začala. Po výpadku servera sa dosiahne najviac včerajšok a dnešok. Neúspešné odoslanie sa opakuje, najviac 5-krát za deň. Skúška SMTP: `http://SERVER:3000/email/nahlad` ukáže náhľad e-mailu, príjemcov a posledné odoslania; tlačidlo „Poslať skúšobný e-mail“ pošle súhrn zvoleného dňa hneď a deň sa tým nepovažuje za odoslaný. Zmeny v `config.json` sa prejavia po reštarte služby.

## 4. ONIX

1. V ONIX DB spustite `docs/onix-view.sql`: založí view `skl_aktivne_dl` a používateľa len na čítanie. Heslo zmeňte.
2. Overte názvy stĺpcov na reálnej DB (súbor má v komentároch, čo overiť) a hodnoty stavov a druhov DL: `SELECT DISTINCT stav, druh FROM skl_aktivne_dl;`.
3. Ak SkladPulz beží na inom serveri ako ONIX: povoľte v `pg_hba.conf` prístup pre `skladpulz_ro` z IP servera SkladPulz a otvorte port 5432 vo firewalle len pre túto IP.
4. Overenie: `npm run onix:check` vypíše počet aktívnych DL a koľko z nich nemá hmotnosť.
5. Čiarový kód čísla DL v tlači DL doplní KROS (#6, `docs/kros-ciarovy-kod.md`).

## 5. Spustenie ako služba Windows

Aby SkladPulz bežal aj po reštarte servera a bez prihláseného používateľa, nainštalujte ho ako službu, napr. cez [NSSM](https://nssm.cc):

```bat
nssm install SkladPulz "C:\Program Files\nodejs\node.exe" "--disable-warning=ExperimentalWarning src\main.ts"
nssm set SkladPulz AppDirectory C:\SkladPulz
nssm set SkladPulz AppStdout C:\SkladPulz\data\skladpulz.log
nssm set SkladPulz AppStderr C:\SkladPulz\data\skladpulz.log
nssm set SkladPulz Start SERVICE_AUTO_START
nssm start SkladPulz
```

Firewall: povoľte prichádzajúce TCP na porte 3000 z vnútornej siete skladu.

Overenie po spustení: `npm run smoke -- http://localhost:3000` musí vypísať 3× OK.

## 6. Záloha

`npm run backup` uloží konzistentnú kópiu databázy do `data\zaloha\` (aj počas behu) a ponechá posledných 30 kópií. Naplánujte ho v Plánovači úloh Windows raz denne po poslednej zmene (program `npm.cmd`, argumenty `run backup`, spustiť v `C:\SkladPulz`). Priečinok `data\zaloha` zahrňte do zálohy servera.

Obnova: zastavte službu, nahraďte `data\skladpulz.db` zálohou, zmažte `skladpulz.db-wal` a `skladpulz.db-shm`, spustite službu.

## 7. Stanice a skenery

1. V SkladPulz založte stanice (Nastavenia) a skladníkov (Zamestnanci), vytlačte karty a tabuľku riadiacich kódov.
2. Na každej stanici otvorte v prehliadači `http://SERVER:3000/stanica/<číslo>` (odkaz je v Nastaveniach) a dajte ho na celú obrazovku (F11). Na Android termináli pridajte stránku na plochu.
3. Skener nastavte do režimu klávesnice (HID keyboard) s ukončením **Enter** a s rozložením klávesnice zhodným so systémom stanice (inak píše „Yéé+ľ“ namiesto „Z0012“; SkladPulz to opraví sám, ale správne nastavenie je istejšie).
4. Test na každej stanici: pípnite kartu, `C-VYCH` alebo `C-BAL`, vytlačený DL, `C-PAUZA`, `C-POKRAC`, `C-KONIEC`, `C-ODHLAS`. Každé pípnutie musí dať zelenú alebo očakávanú farbu a zvuk. Zvuk sa v prehliadači zapne po prvom pípnutí.
5. Výsledok testu zapíšte do protokolu (stanica, skener, čo prešlo).

## 8. Zaškolenie

- Skladníci: `docs/navod/skladnik.md` (jedna strana, vytlačiť ku každej stanici).
- Vedúci: `docs/navod/veduci.md`.
- GDPR: zákazník informuje zamestnancov o meraní a doplní smernicu (otázka v #1).
