# 0001: Stack

Date: 2026-10-30. Status: accepted by the agent under *Who decides* (technical, reversible); Kardy may overturn it before stage 1 is installed.

## Decision

- **Runtime**: Node.js 22 LTS (22.18 or later) running the TypeScript sources directly through Node's type stripping. No build step for the server. Browser code (`src/client`) is compiled with `tsc` into `public/js`.
- **Web**: Hono on `@hono/node-server`. Pages are rendered on the server with Hono's escaping `html` template; the only browser script of substance is the scan station.
- **Own database**: SQLite through Node's built-in `node:sqlite`, one file (`data/skladpulz.db`), migrations as SQL in `src/db/migrations.ts`. Backup is a copy of one file (`VACUUM INTO`).
- **ONIX**: read-only PostgreSQL connection with `pg` to the view `skl_aktivne_dl` (#3). Tests run the view against PGlite, a WASM PostgreSQL.
- **Files**: Excel with `exceljs`, barcodes (Code 128) as SVG with `bwip-js`, e-mail with `nodemailer`.
- **Tests**: `node --test` for unit, store and route tests; Playwright for the batch-tier smoke paths and the demo recording.

## Why

- The customer runs ONIX on a Windows server in their own network, and SkladPulz installs next to it (#8). One Node process and one database file install and back up with no database server, no Docker and no IIS module.
- Stations are a browser with a keyboard-wedge scanner (#4), so a server-rendered app plus one small script covers every screen; a SPA framework would add a build and a second app for no screen that needs it.
- SQLite holds the expected load easily: a few thousand records a day, a handful of stations, one writer process.

## Consequences

- `node:sqlite` is marked experimental in Node 22 and prints a warning at start. If its API changes, the store module is the only place that imports it.
- Only erasable TypeScript syntax is allowed (see `AGENTS.md`).
- Moving the own database to PostgreSQL later means porting `src/db` and the SQL in `src/store`; the domain and the routes do not touch SQL.
