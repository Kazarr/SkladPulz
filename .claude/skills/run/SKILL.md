---
name: run
description: Implement every ready ticket unattended, in dependency order, on one integration branch, and finish with a staging demo and a morning report.
disable-model-invocation: true
---

The human has cleared the fog they can and walked away. You turn every **ready** ticket (open, `ready-for-agent`, unblocked) into merged, verified code, then hand back a demo. You coordinate and keep your own context lean; `implementer` subagents write the code.

## Before the loop

- **Ledger**: create `docs/runs/<YYYY-MM-DD>.md` on the integration branch. The first line records the authority the human granted for this run, in their words. Then one line per event (started, merged, parked, verify result), each with a link, stamped from the clock (`date '+%Y-%m-%d %H:%M'` in the same command that appends it; never type the time: typed times ran 70 minutes ahead twice, Servisnik runs 2026-10-26 and 2026-10-30, and one declared a ticket over budget that was 39 minutes in). The ledger is your memory: re-read it after any compaction.
- **Authority**: `AGENTS.md` → *Who decides* governs every open question.
- **Watchdog**: if your harness can schedule a recurring check, schedule one every 30 min that notifies the human when the ledger's last line is more than 45 min old.
- **Walking skeleton first**: no ticket from another area starts until every walking-skeleton ticket is merged.

## Loop

Read `.claude/skills/implement-spec/SKILL.md` and follow it over the ready tickets, with these rules on top:

- Implementer subagents are the `implementer` agent. Each reports in ten lines or fewer.
- Start an implementer only while the host carries it: CPU under about 80 % (a project hook may enforce it). Max concurrency is what the machine runs without timeouts, not the size of the frontier.
- **Per-ticket review**: before merging a ticket, run `code-review` on its branch against the integration branch. Blockers get one fix round. Every other finding becomes a ticket or a lesson; file the ticket after the fix round merges, against the merged code, since a blocker fix can rewrite the code a finding names (Servisnik#136). This replaces implement-spec's single final review.
- After each review, call the `lesson` skill once for the findings worth keeping.
- **Park, don't guess**: a ticket that hits a business question, or overruns its budget (two fix rounds, or about 90 minutes), is parked. Comment the question or reason on the ticket, label it `needs-info`, write a ledger line, take the next ticket.
- When the frontier is empty, run the **batch tier** of verify once on the integration branch. When it is red, one `implementer` fixes it and the batch tier runs once more. Still red: park the cause and report it.
- Notify the human only for: a decision only they can make that blocks every remaining ticket, the run dying, the batch finished.

## Hand back

1. Deploy the integration branch to staging, if `AGENTS.md` names a staging deploy, and run the deploy tier.
2. Post the **morning report** as a comment on the root map and notify the human. Keep it to 25 lines or fewer:
   - **Demo**: what to show the customer, with URLs and the click path.
   - **Merged**: ticket names with links.
   - **Parked**: each one with its question and who answers it.
   - **New**: follow-up tickets and fog surfaced during the run.
   - **Verify**: the batch and deploy tier results. Add time and cost if the harness reports them.
3. Open the integration branch's PR to the default branch, ready for review. The human merges.

Done when the report is posted and the PR is open.
