---
name: adopt
description: Bring an existing project, built without dev-lessons, onto this workflow. Vendors core and packs next to what the project already has, fills Who decides and the verify tiers from its real commands, and routes its existing lessons through the lesson ladder. Run once, in the project's repo root.
disable-model-invocation: true
---

An existing project already has a way of working: instructions, hooks, ADRs, a CI, often its own lesson files. **Adopt** connects it to dev-lessons so its universal lessons flow upstream and it receives the packs, without breaking what works. You change the workflow files only, never product code.

Work on a branch `adopt/dev-lessons`; everything lands in one PR the human merges.

## Steps

1. **Inventory.** Read the project's agent instructions (`CLAUDE.md`, `AGENTS.md`, `.claude/**`, `.ai-rules/`), its ADRs, roadmap, README and CI workflows. List what it already has under four headings: instructions, checks (hooks, CI gates, snapshot or golden tests), lesson files (any file of rules learnt from mistakes, wherever it lives), and workflows that overlap `charter`, `run` or `lesson` (custom orchestrators, review loops). Done when the list exists in your notes; it is the basis of the report.

2. **Vendor.** Write `vendor.txt` from the dev-lessons `core/vendor.txt`, plus one line per pack picked from `packs/catalog.md` for the project's real stack and concerns. Before running `tools/vendor.sh`, check every `<dest>` except `tools/vendor.sh` and `.claude/skills/adopt`, which were fetched to start this run. When a path already exists and was not vendored, the project's own file wins. Drop that line and list it in the report. Done when `bash tools/vendor.sh` ran clean and `git status` shows no project file overwritten.

3. **Instructions.** When the project's instructions live in `CLAUDE.md`, move them to `AGENTS.md` with `git mv` and make `CLAUDE.md` contain `@AGENTS.md`. Keep every existing line. Add the template's *Workflow*, *Who decides* and *Definition of done* sections from `core/AGENTS.template.md`. Where the project's own rules already answer a row of *Who decides* (a hard rule, a confirm string, an ADR), the project's rule stays, and the row points to it.

4. **Verify tiers.** Fill each tier with a command the project already runs (CI workflow, README, build file). Never invent a command; a tier with no existing command stays `<fill>` and goes in the report. Wire the edit tier as a `PostToolUse` hook only when a command exists that finishes in seconds, and merge it into `.claude/settings.json` without removing an existing hook. Done when every filled command was run once and passed. When your environment cannot run one (registry blocked, SDK missing), the project PR's CI run is its check; say so in the PR.

5. **Lessons.** Take every line of every lesson file found in step 1 down the ladder of the `lesson` skill:
   - Already a check in the project (a hook, a test, a CI gate): leave it.
   - Universal: search the matching dev-lessons pack first. When it is there, add this project's source to that line; otherwise add the line. All of these go in one PR to dev-lessons on a branch `lesson/adopt-<project>`.
   - Project-only: move it to `.claude/skills/project-lessons/SKILL.md`.
   Rewrite each one into the pack format, one line, keeping its *Check:* when it has one. When a custom workflow reads a lesson file, point its reader at `project-lessons` plus the vendored packs whose lines came from that file, and its writer at the `lesson` skill writing into `project-lessons`. Then delete the file and grep for its path. Moving lines without repointing the reader silently takes them away from the workflow. Do this in its own commit, so the human can revert it alone.

6. **Tracker and maps.** When the project already plans on its tracker (issues, maps, milestones), keep it and link the root map in `AGENTS.md`. When it doesn't, follow `.claude/skills/setup-matt-pocock-skills/SKILL.md`, then chart one root map with `wayfinder` from the roadmap's open items only. Finished work is not charted.

7. **Overlaps.** For each workflow that overlaps `run`, `charter` or `lesson`, write one line: what it does that the core skill does not, and the reverse. Change nothing. The human decides whether to keep it, replace it or merge it.

8. **Stop.** Open both PRs. Report in ten lines or fewer: the project PR, the dev-lessons PR, the packs picked, lessons moved (universal / project / already checks), vendored entries skipped because the project owns them, tiers left `<fill>`, and the overlap lines.
