# Omie shipping automation: MFA-assisted browser worker

## Scope

This document defines the implementation boundary for completing the Omie shipping workflow after the application has created and reconciled a sales order. The first milestone is an assisted MFA handshake. It must not change the existing production web service or create/update real Omie orders.

## User experience

1. The application creates or locates the existing Omie order using its integration code. It never retries order creation when existence is uncertain.
2. A dedicated background worker opens the existing order in the Omie web interface using a dedicated robot account.
3. If Omie requests an email one-time code, the worker pauses the browser job and publishes a challenge state for the application.
4. The application displays **Aguardando código de segurança do Omie** and accepts the code from an authenticated operator with an allowed role.
5. The code is delivered to the worker over a private, short-lived channel. The worker submits it to the genuine Omie MFA prompt and resumes the same browser session.
6. The worker verifies the order, carrier, saved package, selected service and freight quote before reporting completion. The application only advances the shipping state after verification and sync.

## Security requirements

- Never put the Omie password, MFA code, browser cookies, or browser storage state in source control, client logs, audit logs, analytics, or ordinary database rows.
- MFA codes are transient messages only: one-time consumption, strict TTL (target 2 minutes), no persistence or replay, and never echoed back to the UI after submission.
- The app API must require an authenticated Supabase user, active profile, permitted role, CSRF/origin protection, rate limits, challenge ownership and a random unguessable challenge ID.
- The worker must authenticate to the private message channel. Do not expose an inbound public worker endpoint.
- Use Supabase Realtime private Broadcast over its client-library/WebSocket transport for the one-time code. Do not use database-originated Broadcast, database triggers, or `realtime.send` for MFA codes because those paths can persist messages in `realtime.messages`.
- Keep browser session state in the worker process only unless a reviewed encrypted persistent-session design is explicitly adopted. A worker restart must fail closed and request a fresh login/MFA.
- Do not bypass CAPTCHA, device checks, MFA, or Omie security controls. If an unsupported challenge appears, pause and request human intervention.
- Logs may include challenge IDs, order IDs, timestamps and state transitions only. Never log code, password, cookie, HTML form values or full page screenshots containing personal data.

## Proposed architecture

- **Next.js web service:** authenticated server actions/API routes create a shipping job, expose its non-secret status, and submit the one-time code. Enqueue is a single insert into `omie_shipping_jobs`, idempotent while an active job exists.
- **Supabase:** the durable queue and source of truth for job state. A runner claims the oldest `queued` row with a conditional update and `RETURNING`; only the process that changes the row may execute it. RLS stays enabled. No MFA code is stored here.
- **Free-tier constraint:** do not provision a paid Render Background Worker or any paid datastore. The existing Render web service may sleep/restart and must not be treated as a reliable daemon.
- **Free execution host candidate:** use a scheduled GitHub Actions workflow (minimum practical cadence, initially every 5 minutes) to poll and claim one job at a time, subject to the repository's included Actions minutes and concurrency limits. The workflow must use only GitHub-hosted runners within the free allowance. If the free allowance is exhausted, jobs remain queued; never switch to paid runners or enable billing automatically.
- **MFA handoff:** the app submits the code through a private Supabase Realtime Broadcast topic `omie:mfa:<challenge UUID>`. A narrowly scoped RLS policy checks the authenticated operator owns a live job in `awaiting_mfa` or `mfa_submitted` state and that the channel topic matches its challenge ID. The worker uses its server-only Supabase credential to subscribe to the same private topic. The code is carried only in the WebSocket Broadcast payload and is never written to Postgres, Redis, logs or browser storage. The job record stores only challenge metadata and state.
- **Browser automation:** Playwright Chromium runs only within the permitted GitHub Actions free-minute budget. No persistent browser profile or cookies are stored.
- **Omie:** remains the system of record for carrier, package, service, freight quote, label and tracking. Do not guess service codes or generate labels automatically during the first milestone.

## State model

Use a dedicated shipping job state (not new values in the existing `fulfillments.status` check constraint):

- `queued`
- `running`
- `awaiting_mfa`
- `mfa_submitted`
- `shipping_configured`
- `failed`
- `expired`

A challenge is bound to one worker job and one fulfillment. It expires automatically, can be consumed once, and is invalidated when the job finishes, fails or is cancelled.

## Idempotency and safeguards

- Locate the Omie order by its stored internal ID and integration code before opening it.
- Never create a second Omie order from the browser worker.
- Before changing shipping data, inspect the current carrier, package, service and freight. Skip already-correct fields.
- Do not generate an invoice, shipping label or postage purchase in this milestone.
- Stop if the order is cancelled, already shipped, ambiguous, or does not match the fulfillment.
- Retry only transient navigation/network failures. MFA errors require a fresh operator action.
- Mark the fulfillment complete only after reading back the saved shipping configuration from Omie and syncing the carrier/service/package/freight fields into `shipments`.

## Delivery sequence

1. Implement and test the transient MFA channel and UI without connecting a live Omie account.
2. Add a scheduled GitHub Actions runner skeleton, atomic Supabase claim, bounded execution and safe cancellation. Confirm included free Actions minutes before enabling the schedule. Do not provision paid infrastructure.
3. Add Playwright login and MFA detection against an explicitly approved test account/session.
4. Validate navigation and selectors on a non-production/test order; collect redacted evidence.
5. Add package `UBER`, Correios and `Mini Envios` selection only after confirming the exact labels and behavior in the actual Omie account.
6. Run a supervised end-to-end test. Do not merge to `main` or deploy the worker until the diff, infrastructure plan, credentials and test outcome are reviewed.

## Open implementation dependency

The Render workspace has the Next.js web service on Free and a private Key Value instance `omie-mfa-free` on Free. No Render Background Worker has been created. The project must remain on free plans only. The proposed execution host is GitHub Actions on included free minutes; its schedule and external Redis connectivity must be validated before enabling live processing. The robot account credentials must be entered directly into Render's private environment settings, never into chat or GitHub.


## Infrastructure validation (2026-11-05)

- The repository is currently **public**. GitHub documents standard GitHub-hosted Actions runners as free for public repositories. This makes Actions a viable zero-cost execution candidate while the repository remains public and the workflow uses standard hosted runners. If repository visibility changes to private, re-check the account's included minutes and billing settings before enabling execution.
- The Render Key Value instance is confirmed available on the Free plan, but its external IP allow list is empty. Render documents that this blocks all external connections; GitHub-hosted runners cannot use the internal Render network. Do not open Redis to 0.0.0.0/0 merely to make the runner connect.
- **Preferred MFA-channel candidate:** Supabase Realtime Broadcast using a private channel and client-library/WebSocket broadcast. Supabase documents that client-library Broadcast is delivered over WebSockets, while database-originated Broadcast is stored in realtime.messages and retained for up to 3 days. Therefore, only the client-library path is eligible for the no-persistence MFA requirement.
- Before adopting Realtime for MFA, validate private-channel authorization for the runner identity, topic scoping to the random challenge ID, sender authorization, short-lived worker subscription, and message acknowledgement. Do not add broad policies to realtime.messages; do not use database-originated Broadcast for MFA codes.
- No Realtime policies or settings have been changed. No GitHub Actions workflow has been enabled. No job has been executed.
