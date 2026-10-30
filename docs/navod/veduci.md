# SkladPulz – návod pre vedúceho skladu

SkladPulz otvoríte v prehliadači na adrese, ktorú vám dal technik (napr. `http://sklad-server:3000`). Prihláste sa svojím menom a heslom. Stanice pri skeneroch prihlásenie nepotrebujú.

## Každý deň

1. **Na kontrolu** – záznamy, ktoré nevstupujú do hodnotenia, kým ich neskontrolujete:
   - *Neukončený* – skladník zabudol pípnuť KONIEC alebo ODHLÁSIŤ; záznam sa uzavrel sám po konci zmeny. Doplňte skutočný koniec.
   - *Podozrivo krátky / dlhý* – kratší ako 20 s alebo dlhší ako 2 h (hranice nastaví technik). Ak je v poriadku, **Potvrďte**; ak nie, **Opravte** alebo **Vylúčte**.
   - *Duplicita* – ten istý DL s tou istou činnosťou má viac záznamov. Jeden potvrďte, ostatné vylúčte.
   - *Chýbajú údaje DL* – DL sa pípol, keď bol ONIX nedostupný, a údaje sa zatiaľ nedotiahli.
   Každá zmena vyžaduje dôvod a zapíše sa (kto, kedy, pôvodná a nová hodnota). Nič sa nemaže; vylúčený záznam sa dá vrátiť.
2. **Denný prehľad** – po skladníkoch a činnostiach: počet DL, položiek, kg, čistý čas (bez páuz), rýchlosť za hodinu a výkonový index. Pod súhrnom sú všetky záznamy dňa s filtrom. Kliknutím na číslo DL vidíte, kto ho vychystal a kto zabalil.
3. **Export do Excelu** na každej stránke s tabuľkou.
4. Po poslednej zmene vám príde **e-mail so súhrnom dňa** (ak ho technik zapol).

## Raz za týždeň / mesiac

- **Porovnanie** – za deň, týždeň, mesiac alebo vlastné obdobie, zvlášť pre vychystanie a balenie: odchýlka od priemeru tímu a trend oproti minulému obdobiu. Prepínač **Pásma** ukáže horných 30 % / stred / dolných 30 % namiesto poradia – vhodnejšie, ak výsledky uvidia aj skladníci.
- **Výkonový index** – porovnáva ľudí spravodlivo aj pri rôzne veľkých DL (norma času = pevný čas + čas na položku + príplatok za kg, tím = 100 %). Po 2–4 týždňoch merania stlačte **Vypočítať z dát**, skontrolujte návrh a prevezmite ho. Popis výpočtu pre zamestnancov je priamo na stránke.

## Zamestnanci a stanice

- **Zamestnanci** – nový skladník dostane kód karty sám (Z0009…). Odchod: **Deaktivovať** (história zostane, karta prestane fungovať). **Tlač kariet** – zaškrtnite ľudí a vytlačte na A4 v mierke 100 %.
- **Nastavenia** – stanice a ich predvolená činnosť; odkaz „Otvoriť stanicu“ dajte otvoriť na PC/termináli pri skeneri.
- **Tlač riadiacich kódov** – tabuľka na stôl ku každej stanici.

## Keď niečo nefunguje

| Čo vidíte | Čo urobiť |
|---|---|
| Stanica: „Neznámy dodací list“ | Číslo DL nie je v ONIXe, alebo skener číta zle. Skúste pípnuť znova; ak sa opakuje, zavolajte technika. |
| Stanica: „ONIX je nedostupný, údaje DL sa doplnia neskôr“ | Práca sa meria ďalej; údaje DL sa doplnia samé. Ak to trvá dlho, zavolajte technika. |
| Úvodná stránka: chyba poslednej synchronizácie ONIX | Zavolajte technika (`npm run onix:check`). |
| Stanica: „Server neodpovedá“ | Skontrolujte sieť stanice; server môže byť vypnutý. |
