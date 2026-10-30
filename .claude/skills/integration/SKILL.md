---
name: integration
description: Lessons for integrating with external systems (ERP, payments, carriers, any third-party API). Use when designing a sync or connector, writing its client, retry or error handling, logging it, or recording fixtures from it.
---

# Integration with external systems: lessons

## Reality first

- Get sandbox access and record real responses for every call before building against a system; the field-mapping spec marks each row decided, verified on the live API, or open. Why: three live mismatches and a field that took three deploys to get right all came from docs-based assumptions. Source: pesitro#179, #231–#234.
- Before writing "no sandbox" from public docs, ask the human who decides whether the vendor runs a test environment, and record its hosts and how to get access. Why: KROS research concluded "no sandbox" from its docs, but KROS runs one on `*.kros.wtf`, and the reality gate had been planned around the production API. Source: Kazarr/Servisnik#49.
- When a ticket establishes a fact about the API, update every docblock, doc and open-question row that stated the old assumption, in the same commit. Mark a row verified only when it was verified on the API or decided by the customer. Source: pesitro#179, #222.
- Live access runs through one wrapper with an explicit write budget (for example "one test order"), and live credentials never enter a shared dev environment. Why: a parallel session started a dev environment with live ERP credentials. Source: pesitro#156, retro 2026-10-21.
- Key test-versus-production behaviour to one mode variable: test mode forces the vendor's test marker, production rejects it, and no other setting can switch either. Source: elsteo `ELSTEO_MODE`, #209.
- A sentence in docs or API descriptions saying the external system accepts a request is proved by a run against that system, never by the mock. Check: every such sentence names the gate test that sent exactly that shape. Why: integrators were told a one-field upload files unchanged, while the same branch's gate recorded the real system refusing it. Source: elsteo#269.

## Shape of a connector

- Keep the client and the planning logic free of the framework: a pure planner takes the remote data and returns a plan (`create`, `update`, `hide`, `log`); a thin shell applies it. Fake only the transport you don't own. Source: pesitro ADR 0001, `ProductUpdates`.
- Validate the whole response shape before any write; a bad shape changes nothing. An empty list from the remote changes nothing either (safety fuse). Source: pesitro `ProductUpdates`.
- Document field ownership (which side owns price, stock, name, images) and write only on a diff. Source: pesitro `docs/onix`.
- Make sends idempotent: store the remote id and never resend an entity that has one; send a deterministic external id (`<app>-<entity id>`) so a retry upserts instead of duplicating. Source: pesitro `OrderExport`, `OrderDocument`.
- Status synced from the remote moves forward only (a rank table), and the docs say what a manual change in the other direction does. Why: the next sync would have reverted it and emailed the customer twice. Source: pesitro#155.
- After a remote call, re-read the local entity and skip it when it changed meanwhile. Source: pesitro `OrderExport`.
- Page through remote and local lists, and match with a map, not nested scans. Why: an unpaged pull of 12.4k cards weighed 24 MB. Source: pesitro `docs/onix`.

## Failure handling

- Classify every error as retryable (transport, 5xx, rate limit) or permanent (validation, unsupported entity). Retry with bounded backoff; after the last attempt, alert a human and give them a manual "send again" action. A partial success is stored and alerted, never retried. Source: pesitro `OrderExport`.
- Honour `Retry-After` with a cap, so a queue worker is never blocked for long. Source: pesitro `Client`.
- Every branch that ends a retry round (success, last attempt, permanent error) resets the attempt counter, with a test. A refactor keeps the order of side effects: log before save and before scheduling. Source: pesitro#159.
- Whoever catches an integration exception without rethrowing logs it, with the ids of every affected entity, including on batch calls. After an effect that cannot be undone (a filing sent, a payment taken), catch everything the runtime can throw, so the answer still carries the results already achieved. Why: a response without the remote id went unlogged through four retries (8.5 h); a native fault mid-batch answered a bare 500 and dropped the receipts of filings already sent. Source: pesitro#154, #158, elsteo#250.
- A rule over the remote's error codes ("these end the batch, those don't") is decided per family of its whole code table, not from the codes the ticket names. Check: the PR says which side each family lands on, and a test pins one code per family. Why: a rule written as two status values sent every row on an unreadable certificate and stopped on a single rejected filing, both backwards. Source: elsteo#250.
- A note or log about sending states the actual result of the send call; on failure it tells staff what to do by hand. Source: pesitro#205.
- Provide a health-check command that exercises auth and required remote configuration read-only, and exits non-zero on failure. Source: pesitro `ConnectionCheck`.
- Persist each exchange (entity, direction, payload, status, attempts, correlation id) in an integration log. Why: without stored payloads there was no replay and no diff, only free-text logs. Source: pesitro architecture review 2026-10-21.

## Data from the wire

- Validate JSON values by type (`is_int`, `typeof === 'number'`), not "numeric". A numeric string is a shape error. Source: pesitro#35.
- Round sums of float quantities before flooring or casting (`0.7 + 0.2 + 0.1` floors to 0). Source: pesitro#35.
- Two windows that must agree (the remote query's `since` and the local query's `modified after`) are computed from the same value at the same precision, and tested at a day boundary in a non-UTC site timezone. Source: pesitro#205.
