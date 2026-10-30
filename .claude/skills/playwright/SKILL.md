---
name: playwright
description: Lessons for Playwright end-to-end tests. Use when writing or fixing a Playwright spec or fixture, taking screenshots, running axe, or chasing a flaky e2e test.
---

# Playwright: lessons

## Fixtures that catch silent failures

- Give the shared `page` fixture teeth: fail the test on any console error, uncaught page exception or HTTP 5xx, and fail the run when the backend log gains a new error, warning or deprecation. Why: these caught breakage that no assertion looked at. Source: pesitro `tests/e2e/fixtures.ts`, `global-setup.ts`.
- Pages the fixture did not create escape its watchers: `target="_blank"` popups (catch them with `page.waitForEvent('popup')` and assert inside) and every `context.newPage()` (watch them through `context.on('page')` in a `context` fixture), plus pages of a second `browser.newContext()`, which no context fixture sees (watch them where the spec creates them). Source: pesitro#82, Servisnik#118, #130.
- Before reading a JSON API response, assert `response.ok()`. Why: a 4xx otherwise shows up later as `undefined` ids or wrong totals. Source: pesitro#149.
- Export helpers two specs need from the fixtures file, and grep the e2e folder before writing a login, cart or checkout block or a test-data builder (VINs, per-run tags). Why: copies lose details of the original (a skeleton wait) and turn flaky. Source: pesitro#82, #149, #160.
- When specs import app modules (a data layer to seed rows), run the e2e tier after changing any module they import, and keep framework-only imports (`next/*`) out of those modules. Why: specs run under plain Node, so a `next/navigation` import in the data layer broke only e2e while typecheck and unit tests stayed green. Source: Servisnik#130.

## Waiting for the real state

- Before a full-page screenshot or an axe scan, force images to `loading = 'eager'`, wait for `complete && naturalWidth > 0`, then `decode()`. Why: lazy images below the fold stay blank, and `complete` alone fails under load. Source: pesitro#33.
- Test font loading through `document.fonts` entries with status `loaded` plus the font request URLs. Why: `document.fonts.check()` returns true for a family with no `@font-face`, so the test can never go red. Source: pesitro#68.
- Prove a deferred stylesheet (`media="print"` + `onload`) applied by asserting a property only that file sets (`toHaveCSS('position', 'fixed')`), not visibility. Source: pesitro#140.
- A test that reads text out of a `page.pdf()` follows form XObjects (`/Name Do` in the page stream). Why: when anything on the page blends (`mix-blend-mode`, some filters), Chromium draws the whole page into a form, so a reader of the page stream alone found no text and every text assertion failed. Source: Servisnik#150.
- Retry hydration races with `expect(...).toPass()` around the action plus its check, not with sleeps. Source: pesitro `clickUntil`.
- Mark one slow test with `test.slow()` and a comment saying why, without measured timings (they go stale); leave the global timeout alone. When only repeated runs are slow, make it conditional: `test.slow(test.info().project.repeatEach > 1, "shared server")`. Why: a raised global timeout hides hangs in every other test, and an unconditional `slow()` triples the timeout of every normal run. Source: pesitro#33, Servisnik#93.
- Pass Playwright flags through a pnpm script without `--`: `pnpm e2e --repeat-each=5`. Why: pnpm 12 forwards the `--`, Playwright reads `--repeat-each=5` after it as a file filter and runs every test once, so a "repeat-each green" proved nothing. Source: Servisnik#93.
- Read lists and counts through a retrying assertion (`toHaveText([...])`, `toHaveCount`), never `allTextContents()` or `textContent()` right after a click or navigation. Why: after a client-side navigation `allTextContents()` read the previous page and returned `[]` under load, so the batch tier went red while every ticket's own run was green. Source: Servisnik run 2026-10-26.
- Give every spec its own data, tagged per run (e.g. a random suffix on names and unique keys), and assert only the rows it created. Why: workers and `--repeat-each` share one database, so fixed names matched other runs' rows and fixed VINs collided. Source: Servisnik run 2026-10-26.
- Data that exists once per app (a logo, a settings row) cannot be tagged per run: keep every step that changes it in one test, so workers and `--repeat-each` cannot interleave them. Why: two logo specs each removed the logo in `beforeEach` and raced. Source: Servisnik#122.

## Assertions that mean something

- After an action, assert something that was false before it, and wait for the action to land first (`page.waitForURL(u => u.searchParams.get('q') === text)` after a search submit). Why: a search test asserted columns already shown by the previous search, so it passed without the new search ever running. Source: Servisnik#70.
- Selection and prefill tests use a value that is not the default. Why: picking the default changes nothing and passes even when the selection is never sent, and a form prefilled from settings passed while showing the migration default that a hardcoded constant would also show. Source: pesitro#103, Servisnik#119.
- Find the page heading inside `main` (`main h1`). Why: outside the homepage the site title in the header is also an `h1`. Source: pesitro#131.
- Read expected design values (colours, sizes) from the design-token source, not hard-coded hex. Source: pesitro#99.
- Emulate `forcedColors: 'active'` when information is carried only by a background (dots, bars, swatches). Source: pesitro#131.
- Responsive image tests run in both Chromium and WebKit: Chromium keeps `sizes="auto"` after `loading = 'eager'` and hides a wrong `sizes` calculation that WebKit exposes. Source: pesitro#140, #229.
