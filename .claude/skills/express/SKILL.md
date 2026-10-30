---
name: express
description: Deliver a same-day customer job (a landing page, a one-screen tool, a form flow) from brief to deployed demo, with lessons sent upstream.
disable-model-invocation: true
---

**Express** takes a brief to a deployed demo within a working day, on the same rails as every other project: vendored packs, verify tiers, per-ticket review, lessons sent upstream. One spec issue stands in for the root map, and the human stays in the chat to answer for the customer. You coordinate; `run` and its implementers write the code.

## Steps

1. **Fit and brief.** Express fits a job of one business area, five tickets or fewer, at most one external system (a form that emails, a payment link) and a deadline in hours. A brief that exceeds any of these goes to `/charter`: say so and stop. Otherwise note the time, which starts the report's clock, and get from the human in one message: who it is for, the one action a visitor should take, the copy and assets they already have, the hosting target and access to it, and the deadline. Done when each is answered or marked unknown.

2. **Setup.** Create the branch `express/<slug>`. It is the integration branch for the whole job, and everything lands in its one PR.
   - Add to `vendor.txt` each pack whose *Pick when* matches in `packs/catalog.md` of the dev-lessons repo (URL in `vendor.txt`), then run `bash tools/vendor.sh`.
   - Read `.claude/skills/setup-matt-pocock-skills/SKILL.md` and follow it with GitHub Issues. Its `## Agent skills` block goes into `AGENTS.md`.
   - Record the simplest stack that runs on the hosting target (a static site for a landing page) in a short ADR `docs/adr/0001-stack.md`.
   - In `AGENTS.md`, the *Who decides* row for business rules reads "The human in chat, answering for the customer; answers recorded in the spec issue; never invented". Under *Workflow*, add the staging and production deploy commands for the host, production marked "only on the human's go".
   - **Reality gate**: hosting credentials live outside the repo, and one authenticated read-only call to the host (list sites, whoami) succeeds from where agents run.

   Done when `vendor.sh` ran clean, the ADR names the stack and host, and the reality-gate call succeeded.

3. **Spec.** Read `.claude/skills/to-spec/SKILL.md` and follow it, with these rules on top:
   - The spec issue opens with the destination, the deadline, the time the brief arrived and what done means. `AGENTS.md` links it as the root map.
   - Its *Questions* section is the question ledger: numbered, each naming who answers. Ask them in chat now and paste each answer verbatim with the date.
   - Label it `needs-info` and pin it, like charter's ledger. `ready-for-agent` stays on tickets, since `run` picks up every open issue that carries it.

   Done when the spec issue is published and every question about copy, prices or claims is answered.

4. **Direction.** When the look is undecided, read `.claude/skills/prototype/SKILL.md` and follow its *What should this look like?* path on one throwaway static page, since no app exists yet: two or three variants, 30 minutes at most, and the human picks one. The prototype's pointer and verdict go on the spec issue, and the chosen variant joins the spec's *Implementation Decisions*. Skip this step when the human brings a design. Done when the spec names the chosen look.

5. **Tickets.** Read `.claude/skills/to-tickets/SKILL.md` and follow it, with these rules on top:
   - Five tickets or fewer, ordered by value, with a **cut-line**: the tickets above it ship even when the deadline arrives first.
   - The first is the **walking skeleton**: the empty page deployed to staging with the commands in `AGENTS.md`, every verify tier filled with a command that ran once and passed, and the edit tier wired as a `PostToolUse` hook when it finishes in seconds.
   - Tickets are blocked only by other tickets. Each quotes the spec-issue answers it needs.

   Done when the human approved the breakdown and the tickets are published `ready-for-agent`.

6. **Build.** Read `.claude/skills/run/SKILL.md` and follow it over the spec's tickets on `express/<slug>`, with these rules on top:
   - The spec issue stands in for the root map, so the morning report goes there as the demo report.
   - The human is present: skip the watchdog, and ask a business question in chat before parking its ticket.
   - Start a ticket below the cut-line only while more than about 90 minutes remain before the deadline.

   Done when `run`'s own completion criterion holds: staging deployed, report posted, PR open.

7. **Ship.** Send the human the staging URL and the click path. Production goes live from the default branch once the human has merged the PR and given the go in their own words: run the production deploy from `AGENTS.md`, then the deploy tier against production. Done when the deploy tier passes on production, or the human chose to hold.

8. **Lessons.** Read `.claude/skills/retro/SKILL.md` and follow it over this session and the run ledger, since the implementers worked in sessions of their own. Then call the `lesson` skill on every finding worth keeping. A finding about express itself (a step that slowed you, a rule that misled you) is a lesson too: a PR to `core/skills/express` in dev-lessons. Done when every finding has a place or a line saying why it was dropped.

9. **Stop.** Report in eight lines or fewer: the demo URLs, the spec issue, the project PR, tickets merged, parked and cut, lessons by rung with their PR links, and the time from brief to demo.
