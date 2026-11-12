import type { SupabaseClient } from "@supabase/supabase-js";

export const ORDER_PAGE_SIZE = 100;
export const ORDER_VIEWS = ["pending", "sent", "review", "cancelled", "all"] as const;
export type OrderView = typeof ORDER_VIEWS[number];
export type OrderTotals = Record<OrderView, number>;
export type OrderListState = {
  view: OrderView; search: string; page: number; pageCount: number; count: number; totals: OrderTotals;
};

const columns = "id, status, omie_order_id, omie_order_number, omie_last_error, customer_purchase_order, customer_email, created_at, recipients(full_name, email), delivery_addresses(city, state, postal_code), fulfillment_items(product_code, description, quantity, unit_price, line_total), shipments(carrier_id, package_count, freight_amount, estimated_delivery_date, service_modality)";

export function orderListParams(params: Record<string, string | string[] | undefined>) {
  const view = ORDER_VIEWS.includes(params.view as OrderView) ? params.view as OrderView : "pending";
  const page = typeof params.page === "string" && /^\d{1,7}$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
  // Exclude filter delimiters while preserving names, email addresses and codes.
  const search = typeof params.q === "string" ? params.q.replace(/[^\p{L}\p{N}\s@_.+-]/gu, " ").trim().slice(0, 100) : "";
  return { view, page, search };
}

export function orderListQuery(client: SupabaseClient, view: OrderView, search = "", head = false) {
  let query = client.from("fulfillments").select(
    head ? "id" : columns + (search ? ",matching_recipient:recipients(),matching_item:fulfillment_items()" : ""),
    { count: "exact", head },
  );
  if (view === "pending") query = query.eq("status", "ready").is("omie_order_id", null);
  if (view === "sent") query = query.not("omie_order_id", "is", null);
  if (view === "review") query = query.is("omie_order_id", null).not("status", "in", "(ready,cancelled)");
  if (view === "cancelled") query = query.is("omie_order_id", null).eq("status", "cancelled");
  if (search && !head) {
    query = query.ilike("matching_recipient.full_name", `%${search}%`)
      .ilike("matching_item.product_code", `%${search}%`)
      .or(`matching_recipient.not.is.null,matching_item.not.is.null,omie_order_number.ilike.%${search}%,customer_purchase_order.ilike.%${search}%,customer_email.ilike.%${search}%`);
  }
  return query;
}

export async function loadOrderList(client: SupabaseClient, params: ReturnType<typeof orderListParams>) {
  const fetchPage = (page: number) => orderListQuery(client, params.view, params.search)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * ORDER_PAGE_SIZE, page * ORDER_PAGE_SIZE - 1);
  const [first, ...counts] = await Promise.all([
    fetchPage(params.page), ...ORDER_VIEWS.map(view => orderListQuery(client, view, "", true)),
  ]);
  const pageCount = Math.max(1, Math.ceil((first.count ?? 0) / ORDER_PAGE_SIZE));
  const page = Math.min(params.page, pageCount);
  const result = page !== params.page ? await fetchPage(page) : first;
  const totals = Object.fromEntries(ORDER_VIEWS.map((view, index) => [view, counts[index].count ?? 0])) as OrderTotals;
  return {
    data: result.error ? [] : result.data ?? [],
    error: result.error || counts.find(count => count.error)?.error,
    state: { ...params, page, pageCount, count: result.count ?? 0, totals } satisfies OrderListState,
  };
}
