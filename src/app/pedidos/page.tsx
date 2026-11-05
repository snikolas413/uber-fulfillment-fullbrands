import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderManagement, type OrderDraft, type OrderRecipient } from "./order-management";
import { OmieMfaChallenge } from "@/components/omie-mfa-challenge";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
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
      .select("id, full_name, document_number, email, delivery_addresses(id, postal_code, street, number, complement, district, city, state, validation_status, created_at)")
      .order("full_name", { ascending: true })
      .order("created_at", { ascending: false, referencedTable: "delivery_addresses" }),
    supabase
      .from("fulfillments")
      .select("id, status, omie_order_id, omie_order_number, customer_purchase_order, customer_email, created_at, recipients(full_name, email), delivery_addresses(city, state, postal_code), fulfillment_items(product_code, description, quantity, unit_price, line_total)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const recipients = (recipientResult.data ?? []) as unknown as OrderRecipient[];
  const drafts = (fulfillmentResult.data ?? []) as unknown as OrderDraft[];
  const canWrite = ["admin", "gestor", "operador"].includes(profile.role);

  return (
    <>
    <OmieMfaChallenge />
    <OrderManagement
      recipients={recipients}
      drafts={drafts}
      canWrite={canWrite}
      loadError={recipientResult.error || fulfillmentResult.error ? "Não foi possível carregar todos os dados. Atualize a página e confira a conexão." : null}
    />
    </>
  );
}
