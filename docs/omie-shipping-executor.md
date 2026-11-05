# Omie shipping executor

The scheduled GitHub Actions executor is intentionally disabled until the repository variable `OMIE_SHIPPING_WORKER_ENABLED` is exactly `true`. It claims at most one job per run using the atomic Supabase RPC and a single concurrency group. It runs only on the standard GitHub-hosted Ubuntu runner. Do not enable billing or paid runners.

## Required GitHub configuration

Secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OMIE_ROBOT_EMAIL`
- `OMIE_ROBOT_PASSWORD`
- `OMIE_SHIPPING_SELECTORS_JSON`

Variables:
- `OMIE_SHIPPING_WORKER_ENABLED` = `true` only after supervised validation
- `OMIE_LOGIN_URL`
- `OMIE_ORDER_URL_TEMPLATE` containing `{orderId}` or `{orderNumber}`
- `OMIE_CARRIER_VALUE`
- `OMIE_PACKAGE_VALUE`
- `OMIE_SERVICE_VALUE`

`OMIE_SHIPPING_SELECTORS_JSON` must contain exact CSS selectors observed in the authorized Omie account: `email`, `password`, `loginSubmit`, `carrier`, `package`, `service`, `quote`, `confirm`, `verification`. Optional selectors: `mfaIndicator`, `mfaCode`, `mfaSubmit`, `orderIdentity`, `quoteResult`. Do not guess these selectors. The worker stops before modifying shipping if the expected order identity is not visible, if any control is ambiguous, or if saved values cannot be read back.

## MFA

The worker creates a random, short-lived challenge using `set_omie_shipping_mfa_challenge` and receives the code only through a private Supabase Realtime Broadcast subscription. It does not store MFA codes, browser cookies, or browser storage state. The code is submitted directly to the active MFA prompt.

## Scope and safeguards

- The executor never calls Omie's order-creation API.
- It refuses fulfilments without a reconciled Omie internal ID and order number.
- It refuses cancelled, shipped, or label-ready fulfilments.
- It only reports success after the configured verification locator contains the carrier, package and service values.
- It does not call `GerarFrete`, `GerarEtiqueta`, invoice, or postage-purchase operations.
- After success, use the app's existing **Sincronizar frete** action to read freight and update `shipments`.
- The current Omie account's exact selectors and order URL are not known from source code. Keep the schedule disabled until these are captured and a supervised test against the approved pilot order has passed.
