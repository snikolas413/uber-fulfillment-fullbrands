import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OMIE_ROBOT_EMAIL", "OMIE_ROBOT_PASSWORD", "OMIE_LOGIN_URL", "OMIE_ORDER_URL_TEMPLATE", "OMIE_SHIPPING_SELECTORS_JSON", "OMIE_CARRIER_VALUE", "OMIE_PACKAGE_VALUE", "OMIE_SERVICE_VALUE"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required worker setting: ${key}`);

const selectors = JSON.parse(process.env.OMIE_SHIPPING_SELECTORS_JSON);
for (const key of ["email", "password", "loginSubmit", "carrier", "package", "service", "quote", "confirm", "verification"]) {
  if (typeof selectors[key] !== "string" || !selectors[key].trim()) throw new Error(`OMIE_SHIPPING_SELECTORS_JSON requires selector: ${key}`);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const workerId = `gha-${process.env.GITHUB_RUN_ID || randomUUID()}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let activeJob = null;
let heartbeatTimer = null;

async function heartbeat() {
  if (!activeJob) return;
  const { data, error } = await supabase.rpc("heartbeat_omie_shipping_job", { p_job_id: activeJob.id, p_worker_id: workerId });
  if (error || data !== true) throw new Error("Worker lease was lost; stopping browser actions.");
}
async function failJob(error) {
  if (!activeJob) return;
  const safeMessage = String(error?.message || "Worker failed").replace(/[\r\n\t]/g, " ").slice(0, 450);
  await supabase.rpc("fail_omie_shipping_job", { p_job_id: activeJob.id, p_worker_id: workerId, p_error: safeMessage });
  activeJob = null;
}
async function waitForMfa(page) {
  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  const { data: created, error } = await supabase.rpc("set_omie_shipping_mfa_challenge", {
    p_job_id: activeJob.id, p_worker_id: workerId, p_challenge_id: challengeId, p_expires_at: expiresAt,
  });
  if (error || created !== true) throw new Error("Could not register MFA challenge.");
  const channel = supabase.channel(`omie:mfa:${challengeId}`, {
    config: { private: true, broadcast: { ack: true, self: false } },
  });
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const timeout = setTimeout(() => rejectCode(new Error("MFA challenge expired.")), 4 * 60 * 1000);
  channel.on("broadcast", { event: "mfa_code" }, message => {
    const payload = message.payload || {};
    if (payload.challengeId === challengeId && typeof payload.code === "string" && /^[A-Za-z0-9]{4,10}$/.test(payload.code)) resolveCode(payload.code);
  });
  try {
    const status = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MFA channel subscription timed out.")), 10000);
      channel.subscribe(value => {
        if (value === "SUBSCRIBED") { clearTimeout(timer); resolve(value); }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(value)) { clearTimeout(timer); reject(new Error("MFA channel unavailable.")); }
      });
    });
    if (status !== "SUBSCRIBED") throw new Error("MFA channel unavailable.");
    const code = await codePromise;
    await page.locator(selectors.mfaCode || 'input[autocomplete="one-time-code"]').fill(code);
    await page.locator(selectors.mfaSubmit || 'button[type="submit"]').click();
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    return true;
  } finally {
    clearTimeout(timeout);
    await supabase.removeChannel(channel);
  }
}
async function execute(job) {
  activeJob = job;
  heartbeatTimer = setInterval(() => heartbeat().catch(error => { console.error(error.message); process.exitCode = 1; }), 30000);
  const { data: fulfillment, error } = await supabase.from("fulfillments")
    .select("id,omie_order_id,omie_order_number,status")
    .eq("id", job.fulfillment_id).maybeSingle();
  if (error || !fulfillment || !fulfillment.omie_order_id || !fulfillment.omie_order_number) throw new Error("Fulfillment has no reconciled Omie order identifiers.");
  if (["cancelled", "shipped", "label_ready"].includes(fulfillment.status)) throw new Error("Order is cancelled or already in a shipping/label state; refusing to modify.");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(process.env.OMIE_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator(selectors.email).fill(process.env.OMIE_ROBOT_EMAIL);
    await page.locator(selectors.password).fill(process.env.OMIE_ROBOT_PASSWORD);
    await page.locator(selectors.loginSubmit).click();
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    const mfaSelector = selectors.mfaIndicator || 'input[autocomplete="one-time-code"]';
    if (await page.locator(mfaSelector).count()) await waitForMfa(page);
    const orderUrl = process.env.OMIE_ORDER_URL_TEMPLATE
      .replaceAll("{orderId}", encodeURIComponent(String(fulfillment.omie_order_id)))
      .replaceAll("{orderNumber}", encodeURIComponent(String(fulfillment.omie_order_number)));
    await page.goto(orderUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    const identity = await page.locator(selectors.orderIdentity || "body").innerText({ timeout: 15000 });
    if (!identity.includes(String(fulfillment.omie_order_number)) && !identity.includes(String(fulfillment.omie_order_id))) {
      throw new Error("Opened Omie page does not identify the expected order; no shipping changes were made.");
    }
    const values = [
      ["carrier", process.env.OMIE_CARRIER_VALUE],
      ["package", process.env.OMIE_PACKAGE_VALUE],
      ["service", process.env.OMIE_SERVICE_VALUE],
    ];
    for (const [field, value] of values) {
      const locator = page.locator(selectors[field]);
      if (await locator.count() !== 1) throw new Error(`Expected exactly one ${field} control.`);
      const tag = await locator.evaluate(element => element.tagName.toLowerCase());
      if (tag === "select") await locator.selectOption({ label: value }).catch(() => locator.selectOption(value));
      else await locator.locator("..").getByText(value, { exact: true }).click().catch(async () => {
        await locator.fill(value);
      });
    }
    await page.locator(selectors.quote).click();
    if (selectors.quoteResult) await page.locator(selectors.quoteResult).waitFor({ state: "visible", timeout: 30000 });
    await page.locator(selectors.confirm).click();
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    const verification = await page.locator(selectors.verification).innerText({ timeout: 20000 });
    for (const expected of [process.env.OMIE_CARRIER_VALUE, process.env.OMIE_PACKAGE_VALUE, process.env.OMIE_SERVICE_VALUE]) {
      if (!verification.includes(expected)) throw new Error("Omie did not confirm all expected shipping values after save.");
    }
    const { data: completed, error: completeError } = await supabase.rpc("complete_omie_shipping_job", { p_job_id: job.id, p_worker_id: workerId });
    if (completeError || completed !== true) throw new Error("Shipping was saved but the worker could not close its lease; reconcile the order before retrying.");
    console.log(JSON.stringify({ event: "shipping_configured", jobId: job.id, fulfillmentId: job.fulfillment_id, orderNumber: fulfillment.omie_order_number }));
    activeJob = null;
  } finally {
    clearInterval(heartbeatTimer);
    await context.close();
    await browser.close();
  }
}

const { data: jobs, error: claimError } = await supabase.rpc("claim_omie_shipping_job", { p_worker_id: workerId });
if (claimError) throw new Error("Could not claim Omie shipping job.");
if (!jobs?.length) { console.log("No queued Omie shipping jobs."); process.exit(0); }
try {
  await execute(jobs[0]);
} catch (error) {
  console.error("Omie shipping worker stopped. Review the run metadata; page content and credentials are intentionally omitted.");
  await failJob(error);
  process.exitCode = 1;
}
