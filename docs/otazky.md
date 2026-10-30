# Otvorené otázky a predpoklady

Rozhodnutia, ktoré patria zákazníkovi (pravidlá prevádzky, jeho dáta). Kým neodpovie, SkladPulz robí opatrnú voľbu uvedenú nižšie a dá sa zmeniť v `config.json` bez zásahu do kódu. Úplný zoznam otázok je v zadaní (#1, sekcie 6 a 7); tu sú tie, na ktoré už existuje nastavenie.

| # | Otázka | Kým zákazník nerozhodne | Nastavenie |
|---|---|---|---|
| 1 | Má opakované pípnutie toho istého DL tým istým pracovníkom ukončiť záznam? | Nie, iba upozorní „DL už beží“. Ukončuje sa kódom KONIEC alebo ďalším DL. | `repeatScanEnds` |
| 2 | Aké sú zmeny (časy)? | Ranná 06:00–14:00, poobedná 14:00–22:00. | `shifts` |
| 3 | Kedy sa neukončený záznam uzavrie? | 30 minút po konci zmeny, s koncom v čase konca zmeny a stavom „neukončený“. | `autoCloseGraceMin` |
| 4 | Hranice podozrivo krátkeho a dlhého záznamu? | Pod 20 s a nad 2 h. | `limits` |
| 5 | Ktoré DL sú „aktívne“ (stavy, druhy, dátum)? | Všetky stavy a druhy, nie staršie ako 30 dní. | `onix.activeStates`, `onix.documentTypes`, `onix.daysBack` |
| 6 | Ktoré položky DL sú neskladové (doprava, služby)? | Počítajú sa len riadky so skladovou kartou (`id_stock_items` vyplnené); overiť na reálnej DB. | view `skl_aktivne_dl` |
| 7 | Prepnutie činnosti počas rozpracovaného DL (napr. z vychystania na balenie)? | Rozpracovaný DL sa ukončí (`zmena_cinnosti`) a nová činnosť sa nastaví. | — |
| 8 | Pípne pracovník DL, ktorý nie je v cache a ONIX je nedostupný? | Záznam sa začne s upozornením, údaje DL sa doplnia pri ďalšej synchronizácii. | — |
| 9 | Majú skladníci vidieť poradie? | Porovnanie ponúka pásma (horných 30 % / stred / dolných 30 %) namiesto poradia. | prepínač v porovnaní |

## Technické predpoklady

- Skener posiela kód ako klávesnica a ukončí ho Enterom. Ak je na PC slovenské rozloženie klávesnice a skener píše „Yéé+ľ“ namiesto „Z0012“, SkladPulz to opraví sám; správne je však nastaviť skener na rozloženie zhodné s PC (návod skenera, „Keyboard country“).
- Čísla DL sa porovnávajú presne tak, ako ich vráti ONIX v `ns_number` (bez zmeny veľkosti písmen).
- Synchronizácia s ONIXom beží každých `onix.syncIntervalMin` minút. Prázdny zoznam aktívnych DL sa berie ako chyba ONIXu alebo zlého filtra: nič sa nezmení a hlásenie je na úvodnej stránke. Výpadok ONIXu stanice nezastaví, pracujú s uloženými údajmi.
- `npm run onix:check` vypíše počet aktívnych DL a koľko z nich nemá hmotnosť (podiel kariet bez hmotnosti je otvorená otázka v #1).
