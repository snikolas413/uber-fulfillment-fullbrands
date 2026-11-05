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
- Use a private Render Key Value channel with a no-eviction policy and short TTL for challenge messages; do not use `integration_events` as a secret store or MFA queue.
- Keep browser session state in the worker process only unless a reviewed encrypted persistent-session design is explicitly adopted. A worker restart must fail closed and request a fresh login/MFA.
- Do not bypass CAPTCHA, device checks, MFA, or Omie security controls. If an unsupported challenge appears, pause and request human intervention.
- Logs may include challenge IDs, order IDs, timestamps and state transitions only. Never log code, password, cookie, HTML form values or full page screenshots containing personal data.

## Proposed architecture

- **Next.js web service:** authenticated server actions/API routes create a shipping job, expose its non-secret status, and submit the one-time code. Enqueue is a single insert into `omie_shipping_jobs`, idempotent while an active job exists.
- **Supabase:** the durable queue and source of truth for job state. A runner claims the oldest `queued` row with a conditional update and `RETURNING`; only the process that changes the row may execute it. RLS stays enabled. No MFA code is stored here.
- **Free-tier constraint:** do not provision a paid Render Background Worker or any paid datastore. First implement a runner that can be invoked by the existing web service and processes one job at a time, with a strict execution timeout and durable checkpoints. Because a free web instance may sleep/restart and is not a guaranteed worker, this is best-effort until a reliable free execution host is explicitly validated.
- **MFA handoff:** keep the code transient and one-time. Prefer an in-process handoff only when the same live process owns the browser session; do not pretend a separate web process can read another process's memory. If a free private Key Value plan is available in the account, validate its limits and availability before using it. Never silently upgrade to a paid plan.
- **Browser automation:** Playwright Chromium runs only within the permitted free execution budget. No persistent browser profile or cookies are stored.
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
2. Add the runner skeleton, atomic Supabase claim, bounded execution, health checks and graceful shutdown. Do not provision paid infrastructure.
3. Add Playwright login and MFA detection against an explicitly approved test account/session.
4. Validate navigation and selectors on a non-production/test order; collect redacted evidence.
5. Add package `UBER`, Correios and `Mini Envios` selection only after confirming the exact labels and behavior in the actual Omie account.
6. Run a supervised end-to-end test. Do not merge to `main` or deploy the worker until the diff, infrastructure plan, credentials and test outcome are reviewed.

## Open implementation dependency

The current Render workspace has the Next.js web service but no background worker or private Key Value instance. The project must remain on free plans only. A Render Background Worker is not assumed to be free; do not create one. Infrastructure creation and deployment are deferred until a free-only execution and MFA transport design is verified. The robot account credentials must be entered directly into Render's private environment settings, never into chat or GitHub.
