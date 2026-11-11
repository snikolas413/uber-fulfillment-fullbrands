import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ShippingManagement, type ShippingRow } from "./shipping-management";

export const dynamic = "force-dynamic";

function firstRelation<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }

export default async function ShippingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) redirect("/acesso-negado");

  const { data, error } = await supabase
    .from("fulfillments")
    .select("id, status, created_at, recipients(full_name), delivery_addresses(city, state, postal_code), shipments(carrier_id, tracking_code, tracking_url, estimated_delivery_date, package_count, service_modality, status, label_storage_path, label_generation_state, freight_amount), invoices(omie_invoice_number, access_key, status)")
    .in("status", ["billing_pending", "billed", "shipping_pending", "label_ready", "shipped"])
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = ((data ?? []) as unknown as ShippingRow[]).filter(row => row.status !== "billing_pending" ||
    ["billing_submitted", "billing_unknown"].includes(firstRelation(row.invoices)?.status ?? "") || Boolean(firstRelation(row.invoices)?.access_key));
  const canGenerate = ["admin", "gestor", "operador"].includes(profile.role);
  return <ShippingManagement rows={rows} canGenerate={canGenerate} loadError={Boolean(error)} />;
}
