# SkladPulz
SkladPulz je nástroj na meranie výkonnosti skladu. Zaznamenáva, kto vychystal a kto zabalil každý dodací list, a z naskenovaných údajov ukazuje tempo práce jednotlivých skladníkov a zmien. Vďaka tomu vidíte, kde sklad beží rýchlo, kde sa spomaľuje a prečo.

## Spustenie

- Vývoj: `npm install`, `npm start` (konfigurácia v `config.json`, vzor `config.example.json`).
- Demo s vymyslenými dátami a falošným ONIXom: `npm run build && node --disable-warning=ExperimentalWarning demo/server.ts` → http://localhost:3300 (vedúci `veduci` / `demo`). Video: `node demo/record-video.ts && node demo/make-video.ts`.
- Overenie: `npm run verify` (typecheck + testy), `npm run e2e` (Playwright).

## Dokumentácia

- Inštalácia u zákazníka: [docs/navod/instalacia.md](docs/navod/instalacia.md)
- Návod pre skladníka: [docs/navod/skladnik.md](docs/navod/skladnik.md), pre vedúceho: [docs/navod/veduci.md](docs/navod/veduci.md)
- ONIX view: [docs/onix-view.sql](docs/onix-view.sql), čiarový kód v tlači DL pre KROS: [docs/kros-ciarovy-kod.md](docs/kros-ciarovy-kod.md)
- Otvorené otázky na zákazníka: [docs/otazky.md](docs/otazky.md)
