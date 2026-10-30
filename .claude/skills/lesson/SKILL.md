---
name: lesson
description: Record a lesson where it stops the mistake from recurring. Use after a code review, a retro, a fix that taught something, or a surprise from a real external system.
---

A **lesson** earns a place only when a fresh session on a current model would get it wrong without it. Everything else is noise that dilutes the lessons that matter.

Before writing, search the target for the same lesson. Sharpen the existing line instead of adding a twin. A lesson that recurs although it is already written is a check waiting to be built: move it to rung 1.

Place each lesson on the first rung that holds:

1. **Check**: the mistake has a mechanical signature (a code pattern, a banned API, a file location, a missing test, a budget). Build it into the verify tier, together with its own test: one example that passes and one that fails. Write no prose.
2. **Universal lesson**: true on any project using this technology or concern. Add it to the matching pack in the dev-lessons repo (URL in `vendor.txt`) on a branch `lesson/<slug>`, and open a PR there. Every project receives it at its next `tools/vendor.sh update`. When no pack fits, propose a new pack in the same PR. Without access to that repo, write it as a project lesson ending in `(universal?)`.
3. **Project lesson**: true only here (this customer, this external system, this data). Add it to `.claude/skills/project-lessons/SKILL.md`, creating it on first use with a description that names the project and the areas it covers.
4. **Review standard**: a judgement call a reviewer applies (consistency, naming, structure). Add it to `CODING_STANDARDS.md`.

Format, one line each:

```markdown
- <Rule, stated as what to do>. Check: <what a reviewer runs or counts to see it held>. Why: <what broke or would break>. Source: <ticket link>.
```

`Check:` is optional. Add it whenever the rule has a runnable or countable proof that is not yet worth building into the verify tier.

Files listed in `vendor.txt` change only through their upstream; edit the upstream instead.
