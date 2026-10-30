# Čiarový kód čísla DL v tlači ONIX (#6) – podklad pre KROS

Túto úpravu robí KROS v ONIXe u zákazníka, nie kód SkladPulz. Tu je, čo SkladPulz od vytlačeného DL potrebuje.

## Čo doplniť do tlačovej zostavy dodacieho listu

- Prvok čiarového kódu typu **Code 128** (Code 128 B alebo auto).
- Obsah: **plné číslo dokladu**, presne hodnota `documents.ns_number` (rovnaký text, aký SkladPulz číta z view `skl_aktivne_dl`). Bez predpony, bez medzier navyše, bez kontrolného textu navyše.
- Umiestnenie: v hlavičke DL, vpravo hore, aby ho skladník pípol bez otáčania listu; na každej strane, ak má DL viac strán.
- Veľkosť: šírka modulu aspoň **0,33 mm** (pri 13-znakovom čísle vychádza kód asi 50–60 mm široký), výška aspoň **12 mm**, tichá zóna aspoň 3 mm vľavo a vpravo. Pod kódom číslo čitateľným písmom.
- Tlač: čierna na bielom, bez rastra. Na ihličkovej tlačiarni overiť čitateľnosť zvlášť.

## Ako overiť

1. Vytlačte 3 rôzne DL (krátke číslo, dlhé číslo, DL s viacerými stranami).
2. Na stanici SkladPulz pípnite kartu, činnosť a DL: musí sa ukázať zelená obrazovka a správny odberateľ.
3. Ak sa ukáže červená „Neznámy dodací list X“: porovnajte zobrazené X s číslom na DL (skener môže mať zlé rozloženie klávesnice; pozri `docs/navod/instalacia.md`, časť 7).

## Otázky pre zákazníka (z #1)

- Ktorú zostavu DL používajú (štandardnú alebo vlastnú)?
- Tlačia DL pred vychystaním, alebo vychystávajú z obrazovky? Ak z obrazovky, nosičom kódu musí byť iný doklad (pick-list, štítok).
