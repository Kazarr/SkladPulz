---
name: review-standards
description: Lessons a code reviewer applies on any stack: comments and docs that tell the truth, complete renames and deletions, refactors that keep behaviour, PRs that say what they did not do, commits that read cleanly. Use when reviewing a diff, refactoring or extracting shared code, or writing comments, docs, PR bodies or commit messages.
---

# Review standards: lessons

## Comments and docs tell the truth

- A comment describes the code that is in the file. Why a rejected alternative failed goes in the commit body. Source: pesitro#213.
- A docblock never claims safety that nothing verifies. It names what can fail and what guards it, including silent failures (a renamed third-party handle that just stops working). Source: pesitro#121, #202.
- A claim about framework or engine behaviour (including a copied performance hint such as "a trigram index would help") is checked in the framework source or engine docs for every caller it names; pg_trgm serves LIKE/ILIKE/regex, not `strpos`. Source: pesitro#141, Servisnik#72.
- A test name claims only what its assertions check. Source: pesitro#141.
- A sentence about a delegating call states the delegate's outcome across all its branches, not the common case. Source: pesitro#213.
- A doc chapter written on the model of another is checked against the code sentence by sentence. Source: pesitro#152.
- When a test's steps or assumptions change, re-read all its comments, including those outside the diff, and drop hypotheses that are now settled. Source: pesitro#220.
- READMEs point at config files instead of repeating thresholds or lists. Source: pesitro#120.
- A number in prose (counts, sizes, limits) comes from a command named in the PR, never from memory. Why: a javadoc said "137 trees, ~80k nodes" where the bundle held 124 and 97,270, after an approving review. Source: elsteo#255.
- Prose that names a frozen artifact as the guarantee ("the snapshot pins this") is checked against what the artifact contains. Check: grep the named fixture for one concrete value the claim covers. Why: a javadoc relied on an OpenAPI snapshot that deliberately skips the catalogs it claimed to pin. Source: elsteo#254.

## Complete renames, deletions and rule changes

- When a ticket deletes or renames a concept or path, grep every form: identifiers, slugs, translated and inflected words in comments and docs, escaped forms in regexes (`\/path\/`), and agent files (`.claude/skills/**`, ignore files, scripts). Dated records (ADRs, changelogs) are exempt. Check: `git grep -n "<old name>"` prints only dated records, and `git ls-files --error-unmatch <path>` succeeds for every repo path prose cites. Source: pesitro#203, #217, elsteo#221, #222, #224, #227, #248.
- When a domain rule changes, grep its constants. When another module computes the same rule its own way, raise it, even if the plan says that module is unchanged. Source: pesitro#151.
- Before tightening who may call a shared function (an access check, a new required argument), grep its callers in every area and list the ones whose users lose access. Why: the customer list became admin-only and the work-order form, another area that reads it, broke for the mechanik unnoticed. Source: Servisnik#69.
- Before adding a constant for a value someone will supply later, grep for the value and the requirement. When a constant is already waiting for it, use that one. Source: pesitro#219.
- When a fixture's meaning changes, rename every data-provider row and docblock that describes it, and add a fixture for any branch it no longer covers. Source: pesitro#233.
- The same computation in two places becomes one function both call. Source: pesitro#96.
- A rule that applies to everything is written as one condition in code, not as a config array with a single value. Source: pesitro#97.

## Refactors and shared code

- An extraction billed as behaviour-preserving keeps the order of its guards, because which refusal a doubly-wrong request gets is visible to callers. Check: list the old and the new method's `throw`s and early `return`s in order; they match, or the PR names the reorder and a test pins it. Why: moving certificate decoding ahead of the paywall turned a suspended tenant's 402 into a 400, while the commit claimed "byte-identical on the wire". Source: elsteo#250.
- A helper shared with a second caller takes the guards the first caller ran around it: the new caller re-applies them, or they move inside the helper. Check: for every member whose visibility the diff widens, list the original call site's checks between parsing and use and point at their twin; a test drives the new caller with each value the old one refused. Why: a second spreadsheet layout reused the path parser without its index guards, so a 1 KB upload was an `OutOfMemoryError`. Source: elsteo#255.
- A lookup moved into a shared module keeps its scope: the same starting node, prefix or filter, not only the same name. Check: a fixture where the wider scope also contains the name proves which match wins. Why: a lookup scoped to one header became document-wide and silently picked another header's element; goldens and the suite stayed green. Source: elsteo#256.
- Production code is not widened or re-sourced to serve a test (a `private` opened, a value read from a second clock), and the module graph gains no cycle. Check: every visibility change in the diff has a production caller; no new import lands in a module the imported one already imports. Source: elsteo#222, #223.

## PRs say what they did not do

- Each acceptance criterion of the ticket is met, or the PR body lists it as unmet in the ticket's own words. Calling it a stretch goal or a scope note is not listing it. Why: a criterion covering 44 forms shipped covering 2 as a "stretch goal", and the missing half would have caught a bug. Source: elsteo#256.
- A defect met while writing a ticket's tests is filed as an issue, not left in a test comment. Check: every "pre-existing" or "found while testing" note in the diff names its issue. Why: a confirmed 500 on the simplest omission had a test comment as its only record. Source: elsteo#269.

## Commits

- `feat` adds behaviour, `fix` changes behaviour already on main (on a run's integration branch: already merged there before this ticket, never behaviour the same ticket added), and the scope comes from the repo's documented list. A commit that touches two packages is split by package; a renamed export that its callers in another package must follow lands as add the new name, switch the callers, drop the old name, and before reporting the typecheck runs on every commit of the series (check out each commit in turn; a rebase would drop the branch's merge commits). Why: split by package alone, three rename commits in a row did not typecheck. Source: pesitro#159, #218, Servisnik#91, #135.
- Commit messages are in English, body included; reviewers read the branch's commit bodies. Source: pesitro#35.
- A merge commit only resolves what its two sides bring; any new code or test goes into a plain commit after it. Why: commit checks and reviewers skip merges, so a shared test helper and a new access-table row that appeared only in a merge were never checked. Source: Servisnik#90.
