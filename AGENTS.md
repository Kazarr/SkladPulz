# SkladPulz

Measures warehouse picking and packing performance for a KROS ONIX customer: workers scan their card and the delivery note (DL), SkladPulz times the work and reports speed per worker. Coordinator: MG (`martingardian-coordinator`); developer: Kardy.

## Workflow

- Plans live as maps on the issue tracker. Root map: https://github.com/Kazarr/SkladPulz/issues/1 (the full analysis is its second comment). Tickets are its sub-issues #2–#12, prefixed `E1:` (stage 1) and `E2:` (stage 2).
- `/run` implements every ready ticket unattended; `/implement <ticket>` does one.
- After a review, a retro, or a surprise from a real system: the `lesson` skill.
- Every ~10 merged tickets: `/improve-codebase-architecture`, findings filed as tickets.
- Everything listed in `vendor.txt` is vendored. `tools/vendor.sh update` pulls new upstream versions; local changes go upstream.
- Code, commits, tests and docs for developers are in English. Everything a user sees (UI, reports, e-mails, manuals in `docs/navod/`) is in Slovak.

## Who decides

| Question | Who |
|---|---|
| Technical, reversible, inside existing ADRs | The agent decides and notes it on the ticket |
| Ambiguous, with a safe option | The agent takes the conservative option, makes it configurable when it is a customer rule, and lists it in `docs/otazky.md` and the run report |
| Hard to reverse, or needs a new ADR | Human (Kardy) |
| Money, contract, customer-visible scope | Human (Kardy), who agrees it with MG |
| Business rules, or data the customer owns | Customer, through the open questions in #1 (sections 6 and 7) and `docs/otazky.md`; never invented |

Sort every question by this table before asking it, grilling rounds included: put only the Human rows to the human, file the Customer rows in the ledger, decide the rest and note it. Why: a grilling round put 13 mostly technical questions to the human, and the human pushed back. Source: https://github.com/Kazarr/Servisnik/issues/55.

## Stack

See `docs/adr/0001-stack.md`. Node 22 runs the TypeScript sources directly (type stripping), so only erasable syntax is allowed: no `enum`, no `namespace`, no parameter properties; imports end in `.ts`. TypeScript strict mode everywhere, server and browser code alike.

## Definition of done: verify tiers

| Tier | Runs | Command | Budget |
|---|---|---|---|
| edit | after every file edit (`PostToolUse` hook) | `bash tools/edit-tier.sh` | seconds |
| ticket | before every merge | `npm run verify` | under 3 min |
| batch | once per run, on the integration branch | `npm run verify && npm run e2e` | once |
| deploy | after every deploy | `npm run smoke -- <base-url>` | minutes |

Business logic is unit-tested without framework, database or network (`src/domain`). Store and route tests use an in-memory SQLite database. ONIX is tested against a PGlite database holding the ONIX tables of `test/fixtures/onix-schema.sql`; it was written from the analysis in #1 and is not yet verified on the customer's database (#3). End-to-end tests cover a few smoke paths and run only in the batch tier.

## Agent skills

### Issue tracker

GitHub Issues on Kazarr/SkladPulz. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
