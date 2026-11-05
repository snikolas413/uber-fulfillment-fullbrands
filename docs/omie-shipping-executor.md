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
- `OMIE_CARRIER_VALUE` = `EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS`
- `OMIE_PACKAGE_VALUE` = `Uber`
- `OMIE_SERVICE_VALUE` = `CORREIOS MINI ENVIOS CTR AG`

`OMIE_SHIPPING_SELECTORS_JSON` must contain exact CSS/Playwright selectors observed in the authorized Omie account:
- `email`, `password`, `loginSubmit`
- `carrierField`: the direct autocomplete field, observed as `input[title="Transportadora"]`. Do not open the carrier search modal. Fill the carrier name, press Enter, and verify the field retained the exact configured value.
- `packageDialog`: dialog identified by the title, e.g. `.ui-igdialog:has-text("Embalagem utilizada no Pedido de Venda")`
- `packageField`: observed as `input[title="Embalagem"]`
- `packageSave`: observed as `a.ui-toolbar-item.SAVE`, scoped inside the package dialog
- `packageClose`: observed as `button.ui-igdialog-buttonclose`, scoped inside the package dialog
- `serviceDialog`: quotation dialog, e.g. `.ui-igdialog:has-text("Cotação do Frete")`
- `serviceConfirm`: text selector for the exact `Confirmar` action, scoped inside the quotation dialog
- `orderDialog`: main order dialog, e.g. `.ui-igdialog:has-text("Pedido de Venda Nº")`
- `orderSave`: observed as `a.ui-toolbar-item.SAVE`, scoped inside the main order dialog
- `verification`: locator whose visible text contains the persisted carrier, package, and service values after saving.

Optional selectors: `mfaIndicator`, `mfaCode`, `mfaSubmit`, and `orderIdentity`. Do not use dynamic dialog IDs such as `dialog-51595` or dynamic input IDs such as `d51595...`.

## Validated UI sequence

1. Open the already existing Omie order and verify its order number/internal ID.
2. Fill the Transportadora autocomplete directly with `EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS`; do not open the separate carrier search dialog.
3. Open the box icon. Fill `Uber`, select/commit the autocomplete value, click **Salvar**, then click **Fechar** on the package dialog.
4. Open the truck icon. The quotation presents `CORREIOS MINI ENVIOS CTR AG`; do not click the result row. Click **Confirmar** directly.
5. Click **Salvar** in the main order dialog.
6. Read back and verify carrier, package, and service before marking the job complete.

## MFA

The worker creates a random, short-lived challenge using `set_omie_shipping_mfa_challenge` and receives the code only through a private Supabase Realtime Broadcast subscription. It does not store MFA codes, browser cookies, or browser storage state. The code is submitted directly to the active MFA prompt.

## Scope and safeguards

- The executor never calls Omie's order-creation API.
- It refuses fulfilments without a reconciled Omie internal ID and order number.
- It refuses cancelled, shipped, or label-ready fulfilments.
- It claims at most one queued job per run and uses the database lease/heartbeat safeguards.
- It stops if a configured control is ambiguous, the carrier autocomplete does not retain the configured value, the package dialog does not close after saving, the Mini Envios quotation or Confirmar action is not uniquely found, or the saved values cannot be read back.
- It does not call `GerarFrete`, `GerarEtiqueta`, invoice, or postage-purchase operations.
- After success, use the app's existing **Sincronizar frete** action to read freight and update `shipments`.
- The current Omie account's login, order URL, and final selectors still require supervised configuration and testing. Keep the schedule disabled until a supervised test against the approved pilot order has passed.
