---
name: project-lessons
description: Lessons learned on SkladPulz (warehouse picking/packing timer on KROS ONIX). Use when touching the scan station, scanners, scheduled jobs (auto-close, ONIX sync, daily e-mail), report parameters, the demo video, or coordinating a run. Lines ending in (universal?) wait to be sent to the dev-lessons packs named in brackets.
---

# SkladPulz: lessons

## Scanners and stations

- Treat a keyboard-wedge barcode scanner as a keyboard in the PC's layout: on a Slovak (QWERTZ) layout a US-configured scanner types "Yéé+ľ" for "Z0012" and "C=PAUYA" for "C-PAUZA". Normalize scans that show the garbled digit row, and tell the installer to set the scanner's keyboard country. Check: a unit test feeds the garbled forms of every code family. Why: every card and control code would read as an unknown delivery note on a Slovak PC. Source: https://github.com/Kazarr/SkladPulz/issues/4 [integration] (universal?)
- A uniqueness rule ("one counted record per note and activity") gets a test where the same person repeats the action, not only a second person. Why: duplicate detection skipped the scanning worker, so re-scanning a finished note counted it twice. Source: https://github.com/Kazarr/SkladPulz/issues/4, review 2026-10-30 [testing-strategy] (universal?)

## Scheduled jobs

- A scheduled report that summarises data another job closes (auto-close at shift end + grace) is due only after that job's deadline, and runs the closing step itself first. Check: a test leaves a record running and asserts it appears as unfinished in the report sent at the earliest due time. Why: the daily e-mail went out at shift end + 15 min while forgotten records closed at + 30 min, so it reported "0 to review". Source: https://github.com/Kazarr/SkladPulz/issues/12, review 2026-10-30 [devops] (universal?)

## Code

- A parameter added for new stored settings has no default value, so the compiler lists every caller. Why: the index weights parameter defaulted to the placeholder weights, and the daily e-mail kept using them after a manager saved real ones. Source: https://github.com/Kazarr/SkladPulz/issues/10, review 2026-10-30 [review-standards] (universal?)

## Demo and Playwright

- To render `<input type="date">` in a locale in headless Chromium, launch it with `env: { LANG: 'sk_SK.UTF-8' }`; `locale` on the context and `--lang` do not change it. Why: the demo video showed US dates (10/28/2026) on a Slovak page. Source: SkladPulz run 2026-10-30 [playwright] (universal?)

## Coordinating a run

- When the harness denies `isolation: worktree` for subagents, create one `git worktree add ../wt-<ticket> -b ticket/<ticket> <integration>` per ticket, symlink `node_modules` into it, and name the path in the brief; parallel implementers then merge cleanly except for append-only files (migrations, route registration). Source: SkladPulz run 2026-10-30 [devops] (universal?)
- Run `pkill -f <pattern>` in a Bash call of its own. Why: the pattern also matches the shell running that command line, so `pkill -f "src/main.ts"; node src/main.ts &` killed its own shell (exit 144), even with a `[s]rc` bracket when the plain text appeared later in the same line. Source: SkladPulz run 2026-10-30 [devops] (universal?)
