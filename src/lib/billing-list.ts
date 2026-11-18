import type { SupabaseClient } from "@supabase/supabase-js";

export const BILLING_PAGE_SIZE = 100;
export type BillingQueue = "prepared" | "pending" | "billed";
export type BillingPageInfo = { page: number; pageCount: number; count: number };
export type BillingListState = Record<BillingQueue, BillingPageInfo>;
export type BillingPages = Record<BillingQueue, number>;

const preparedColumns = "id, customer_purchase_order, customer_email, created_at, delivery_recipient_name,recipients(full_name), fulfillment_items(product_code, description, quantity, unit_price, line_total)";
const fiscalColumns = "id, status, omie_order_id, omie_order_number, omie_last_error, created_at, delivery_recipient_name,recipients(full_name), invoices(omie_invoice_number, access_key, status, issued_at, danfe_url, xml_available, confirmation_state, confirmation_last_error), shipments(carrier_id, service_code, freight_amount)";

export function billingListParams(params: Record<string, string | string[] | undefined>): BillingPages {
  const page = (value: string | string[] | undefined) => typeof value === "string" && /^\d{1,7}$/.test(value) ? Math.max(1, Number(value)) : 1;
  return { prepared: page(params.prepared_page), pending: page(params.pending_page), billed: page(params.billed_page) };
}

export function billingPageUrl(pages: BillingPages, queue: BillingQueue, page: number) {
  return "/faturamento?" + new URLSearchParams({
    prepared_page: String(queue === "prepared" ? page : pages.prepared),
    pending_page: String(queue === "pending" ? page : pages.pending),
    billed_page: String(queue === "billed" ? page : pages.billed),
  });
}

export async function loadBillingQueue(client: SupabaseClient, queue: BillingQueue, requestedPage: number) {
  const fetchPage = (page: number, head = false) => {
    let query = client.from("fulfillments").select(head ? "id" : queue === "prepared" ? preparedColumns : fiscalColumns, { count: "exact", head });
    query = queue === "pending" ? query.in("status", ["order_created", "billing_pending"]) : query.eq("status", queue === "prepared" ? "ready" : "billed");
    if (head) return query;
    return query.order("created_at", { ascending: queue === "pending" }).order("id", { ascending: queue === "pending" })
      .range((page - 1) * BILLING_PAGE_SIZE, page * BILLING_PAGE_SIZE - 1);
  };
  const first = await fetchPage(requestedPage);
  // PostgREST can omit count on an out-of-range response after a queue shrinks.
  const total = first.error?.code === "PGRST103" ? (await fetchPage(1, true)).count : first.count;
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / BILLING_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const result = total !== null && page !== requestedPage ? await fetchPage(page) : first;
  return { ...result, state: { page, pageCount, count: result.count ?? 0 } satisfies BillingPageInfo };
}
