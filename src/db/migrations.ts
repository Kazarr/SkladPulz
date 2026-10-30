/**
 * Schema of SkladPulz's own database (#2). Each entry runs once, in order, inside a transaction;
 * `PRAGMA user_version` holds how many have run. Append only: never edit a migration that shipped.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE zamestnanec (
    id      INTEGER PRIMARY KEY,
    kod     TEXT NOT NULL UNIQUE CHECK (kod GLOB 'Z[0-9][0-9][0-9][0-9]*'),
    meno    TEXT NOT NULL CHECK (length(trim(meno)) > 0),
    aktivny INTEGER NOT NULL DEFAULT 1 CHECK (aktivny IN (0, 1))
  );

  CREATE TABLE stanica (
    id                      INTEGER PRIMARY KEY,
    nazov                   TEXT NOT NULL CHECK (length(trim(nazov)) > 0),
    predvolena_cinnost      TEXT CHECK (predvolena_cinnost IN ('VYCH', 'BAL')),
    aktualny_zamestnanec_id INTEGER REFERENCES zamestnanec(id)
  );

  -- A worker signed in at a station, with the activity they chose there. One row per worker.
  CREATE TABLE prihlasenie (
    zamestnanec_id INTEGER PRIMARY KEY REFERENCES zamestnanec(id),
    stanica_id     INTEGER NOT NULL REFERENCES stanica(id),
    cinnost        TEXT CHECK (cinnost IN ('VYCH', 'BAL')),
    od             INTEGER NOT NULL
  );

  -- Read-only cache of ONIX delivery notes (#3).
  CREATE TABLE dodaci_list (
    cislo           TEXT PRIMARY KEY,
    onix_id_master  INTEGER,
    datum           TEXT,
    odberatel       TEXT,
    stav            TEXT,
    druh            TEXT,
    pocet_poloziek  INTEGER,
    pocet_mj        REAL,
    hmotnost_kg     REAL,
    aktivny         INTEGER NOT NULL DEFAULT 1 CHECK (aktivny IN (0, 1)),
    synchronizovane INTEGER NOT NULL
  );

  CREATE TABLE zaznam (
    id               INTEGER PRIMARY KEY,
    zamestnanec_id   INTEGER NOT NULL REFERENCES zamestnanec(id),
    cinnost          TEXT NOT NULL CHECK (cinnost IN ('VYCH', 'BAL')),
    cislo_dl         TEXT NOT NULL,
    stanica_id       INTEGER REFERENCES stanica(id),
    zaciatok         INTEGER NOT NULL,
    koniec           INTEGER CHECK (koniec IS NULL OR koniec >= zaciatok),
    pauza_s          INTEGER NOT NULL DEFAULT 0 CHECK (pauza_s >= 0),
    cisty_cas_s      INTEGER CHECK (cisty_cas_s IS NULL OR cisty_cas_s >= 0),
    pocet_poloziek   INTEGER,
    pocet_mj         REAL,
    hmotnost_kg      REAL,
    sposob_ukoncenia TEXT CHECK (sposob_ukoncenia IN ('dalsi_dl', 'koniec', 'odhlas', 'zmena_cinnosti', 'koniec_zmeny', 'oprava')),
    stav             TEXT NOT NULL DEFAULT 'bezi' CHECK (stav IN ('bezi', 'ok', 'neukoncene', 'opravene', 'vylucene')),
    podozrenie       TEXT CHECK (podozrenie IN ('kratky', 'dlhy')),
    potvrdene        INTEGER NOT NULL DEFAULT 0 CHECK (potvrdene IN (0, 1)),
    duplicita        INTEGER NOT NULL DEFAULT 0 CHECK (duplicita IN (0, 1)),
    opravil          TEXT,
    poznamka         TEXT,
    CHECK ((stav = 'bezi') = (koniec IS NULL))
  );
  -- A worker has at most one running record.
  CREATE UNIQUE INDEX zaznam_jeden_beziaci ON zaznam(zamestnanec_id) WHERE koniec IS NULL;
  CREATE INDEX zaznam_zaciatok ON zaznam(zaciatok);
  CREATE INDEX zaznam_dl ON zaznam(cislo_dl, cinnost);

  CREATE TABLE pauza (
    id        INTEGER PRIMARY KEY,
    zaznam_id INTEGER NOT NULL REFERENCES zaznam(id) ON DELETE CASCADE,
    od        INTEGER NOT NULL,
    "do"      INTEGER CHECK ("do" IS NULL OR "do" >= od)
  );
  -- A record has at most one open pause.
  CREATE UNIQUE INDEX pauza_jedna_otvorena ON pauza(zaznam_id) WHERE "do" IS NULL;

  CREATE TABLE scan_log (
    id             INTEGER PRIMARY KEY,
    cas            INTEGER NOT NULL,
    stanica_id     INTEGER,
    surovy_kod     TEXT NOT NULL,
    kod            TEXT,
    vysledok       TEXT NOT NULL CHECK (vysledok IN ('ok', 'upozornenie', 'chyba')),
    sprava         TEXT NOT NULL,
    zamestnanec_id INTEGER
  );
  CREATE INDEX scan_log_cas ON scan_log(cas);

  -- Records that enter averages and speeds (glossary: counted record).
  CREATE VIEW zaznam_hodnotene AS
    SELECT * FROM zaznam
    WHERE stav IN ('ok', 'opravene') AND (podozrenie IS NULL OR potvrdene = 1);
  `,
  `
  -- Every send of the daily summary e-mail (#12). A day is done once a row with ok = 1 and skusobny = 0 exists.
  CREATE TABLE email_odoslanie (
    id          INTEGER PRIMARY KEY,
    den         TEXT NOT NULL,
    cas         INTEGER NOT NULL,
    prijemcovia TEXT NOT NULL,
    ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
    chyba       TEXT,
    skusobny    INTEGER NOT NULL DEFAULT 0 CHECK (skusobny IN (0, 1))
  );
  CREATE INDEX email_odoslanie_den ON email_odoslanie(den);
  `,
];
