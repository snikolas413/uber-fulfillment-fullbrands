import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RecipientManagement, type Recipient } from "./recipient-management";

export const dynamic = "force-dynamic";

export default async function RecipientsPage() {
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
    .from("recipients")
    .select("id, full_name, document_number, email, phone, created_at, updated_at, delivery_addresses(id, postal_code, street, number, complement, district, city, state, validation_status, created_at)")
    .order("created_at", { ascending: false })
    .order("created_at", { ascending: false, referencedTable: "delivery_addresses" });

  const canWrite = ["admin", "gestor", "operador"].includes(profile.role);
  const recipients = (data ?? []) as unknown as Recipient[];

  return (
    <RecipientManagement
      recipients={recipients}
      canWrite={canWrite}
      loadError={error ? "Não foi possível carregar os destinatários. Atualize a página ou confira a conexão com o banco." : null}
    />
  );
}
