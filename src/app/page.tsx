import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardOverview, type RecentDashboardOrder } from "./dashboard-overview";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const counts: { recipients: number | null; orders: number | null; billing: number | null; shipped: number | null } = {
    recipients: null, orders: null, billing: null, shipped: null,
  };
  let recentOrders: RecentDashboardOrder[] = [];
  let recentFailed = false;
  let dataLoadFailed = !authData.user;
  if (authData.user) {
    const [recipients, orders, billing, shipped, recent] = await Promise.all([
      supabase.from("recipients").select("id", { count: "exact", head: true }),
      supabase.from("fulfillments").select("id", { count: "exact", head: true }).neq("status", "cancelled"),
      supabase.from("fulfillments").select("id", { count: "exact", head: true }).in("status", ["order_created", "billing_pending"]),
      supabase.from("fulfillments").select("id", { count: "exact", head: true }).eq("status", "shipped"),
      supabase.from("fulfillments").select("id,status,created_at,omie_order_number,recipients(full_name),invoices(omie_invoice_number)")
        .order("created_at", { ascending: false }).limit(6),
    ]);
    counts.recipients = recipients.error ? null : recipients.count ?? 0;
    counts.orders = orders.error ? null : orders.count ?? 0;
    counts.billing = billing.error ? null : billing.count ?? 0;
    counts.shipped = shipped.error ? null : shipped.count ?? 0;
    recentOrders = (recent.data ?? []) as unknown as RecentDashboardOrder[];
    recentFailed = Boolean(recent.error);
    dataLoadFailed = Boolean(recipients.error || orders.error || billing.error || shipped.error || recent.error);
  }
  return <DashboardOverview counts={counts} recentOrders={recentOrders} recentFailed={recentFailed} dataLoadFailed={dataLoadFailed} updatedAt={new Date().toISOString()} />;
}
