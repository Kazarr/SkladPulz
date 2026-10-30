---
name: charter
description: Start a new customer project. Charts the root map of area maps, opens the reality gate and the customer question ledger. Run once, in the new repo's root.
disable-model-invocation: true
---

A customer brief arrives wrapped in **fog**. Charter turns it into a **root map**: a map of maps that the team clears area by area until every area is ready-for-agent tickets. You produce structure and questions, not code.

Inputs are whatever the human hands you: brief, meeting notes, offer, emails. Ask for them when there are none.

## Steps

1. **Tracker.** Read `.claude/skills/setup-matt-pocock-skills/SKILL.md` and follow it, keeping the triage labels. Its `## Agent skills` block goes into `AGENTS.md`. Done when `docs/agents/issue-tracker.md` and `docs/agents/domain.md` exist.

2. **Root map.** Read `.claude/skills/wayfinder/SKILL.md` and chart a map in its *Chart the map* mode, with these rules on top:
   - **Destination**: the project delivered to the customer, in one or two lines.
   - **Notes**: the customer, who speaks for them, which human decides, deadlines, and the lesson packs in use (filled by the stack ticket).
   - The root's children are only **spanning decisions** (stack, architecture, hosting, data ownership) and **area maps**.
   - An **area map** is a wayfinder map (`wayfinder:map`) and a child issue of the root, one per business area (orders, stock, invoicing, customer portal…). Cross-cutting area maps exist only for *stack and architecture* and *deploy and operations*. Cut areas by business capability, never by technical layer.
   - An area map's destination is the area's spec (`to-spec`) plus its implementation tickets (`to-tickets`), published as children of the area map and labelled `ready-for-agent`. Aim for at most ~10 tickets; an area that needs more splits in two.
   - The first area map is the **walking skeleton**: one thin vertical flow through every layer, every external system and a real deploy.

   Done when the root map, its spanning decision tickets and every area map you can name exist, with blocking edges wired. Areas you can't name yet go to the root's *Not yet specified*.

3. **Stack ticket.** On the root map, a `grilling` ticket *Stack and architecture*, blocked by `research` tickets for each serious option. Write its completion criterion into the body:
   - ADR `docs/adr/0001-stack.md` with the options weighed. Testability breaks ties: business logic must run in unit tests without framework, database or network.
   - The matching packs from `packs/catalog.md` in the dev-lessons repo (URL in `vendor.txt`) added to `vendor.txt` and pulled with `tools/vendor.sh`, and listed in the root map's Notes.
   - The verify tiers in `AGENTS.md` filled with real commands, and the edit tier wired as a `PostToolUse` hook in `.claude/settings.json`.

4. **Reality gate.** For every external system (ERP, payments, carrier, identity provider…), `task` tickets on the walking-skeleton map:
   - sandbox access, with credentials stored outside the repo;
   - real responses recorded for every call the project will make, committed as test fixtures;
   - the deploy target reachable from where agents run.

   Nothing is built against an external system until its responses are recorded.

5. **Question ledger.** One issue, *Questions for <customer>*, labelled `needs-info` and pinned. Number the questions and group them by area; each one names who answers it and a needed-by date. Answers are pasted in verbatim with date and source. A ticket waiting on an answer is blocked by the ledger and cites the question number.

6. **Stop.** Report in five lines or fewer: the root map link, the area maps, the current frontier, and the number of open customer questions.
