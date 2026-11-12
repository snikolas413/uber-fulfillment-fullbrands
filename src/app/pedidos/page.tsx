import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderManagement, type OrderDraft, type OrderRecipient } from "./order-management";
import { loadOrderList, orderListParams } from "@/lib/order-list";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active) redirect("/acesso-negado");

  const [recipientResult, fulfillmentResult] = await Promise.all([
    supabase
      .from("recipients")
      .select("id, full_name, document_number, email, used_orders:fulfillments(), delivery_addresses(id, postal_code, street, number, complement, district, city, state, validation_status, created_at)")
      .is("used_orders", null)
      .order("full_name", { ascending: true })
      .order("created_at", { ascending: false, referencedTable: "delivery_addresses" }),
    loadOrderList(supabase, orderListParams(await searchParams)),
  ]);

  const recipients = (recipientResult.data ?? []) as unknown as OrderRecipient[];
  const drafts = (fulfillmentResult.data ?? []) as unknown as OrderDraft[];
  const canWrite = ["admin", "gestor", "operador"].includes(profile.role);

  return (
    <OrderManagement
      recipients={recipients}
      drafts={drafts}
      list={fulfillmentResult.state}
      key={`${fulfillmentResult.state.view}:${fulfillmentResult.state.search}:${fulfillmentResult.state.page}`}
      canWrite={canWrite}
      loadError={recipientResult.error || fulfillmentResult.error ? "Não foi possível carregar todos os dados. Atualize a página e confira a conexão." : null}
    />
  );
}
