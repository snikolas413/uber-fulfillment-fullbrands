"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type QueueShippingResult = { status: "success" | "warning" | "error"; message: string };

export async function queueOmieShippingAction(fulfillmentId: string): Promise<QueueShippingResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return { status: "error", message: "Sua sessão expirou. Entre novamente." };
    const { data: profile, error: profileError } = await supabase.from("user_profiles")
      .select("role,is_active").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) {
      return { status: "error", message: "Seu perfil não pode solicitar a configuração logística." };
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fulfillmentId)) {
      return { status: "error", message: "Pedido inválido." };
    }
    const { data: fulfillment, error } = await supabase.from("fulfillments")
      .select("id,status,omie_order_id,omie_order_number")
      .eq("id", fulfillmentId).maybeSingle();
    if (error || !fulfillment) return { status: "error", message: "Não foi possível localizar a preparação." };
    if (!fulfillment.omie_order_id || !fulfillment.omie_order_number) {
      return { status: "warning", message: "Sincronize o pedido no Omie para confirmar o número interno antes de solicitar o frete." };
    }
    if (["cancelled", "shipped", "label_ready"].includes(fulfillment.status)) {
      return { status: "warning", message: "O pedido está cancelado ou já avançou para etiqueta/envio. A automação não será iniciada." };
    }

    const admin = createSupabaseAdminClient();
    const { data: active, error: activeError } = await admin.from("omie_shipping_jobs")
      .select("id,status").eq("fulfillment_id", fulfillmentId)
      .in("status", ["queued", "running", "awaiting_mfa", "mfa_submitted"]).limit(1).maybeSingle();
    if (activeError) return { status: "error", message: "Não foi possível verificar se já existe uma execução logística ativa." };
    if (active) return { status: "warning", message: "Este pedido já possui uma execução logística em andamento." };

    const { error: insertError } = await admin.from("omie_shipping_jobs").insert({
      fulfillment_id: fulfillmentId, requested_by: auth.user.id, status: "queued",
    });
    if (insertError) {
      if (insertError.code === "23505") return { status: "warning", message: "Já existe uma solicitação logística para este pedido." };
      return { status: "error", message: "Não foi possível colocar a configuração logística na fila." };
    }
    revalidatePath("/pedidos");
    return { status: "success", message: "Configuração logística adicionada à fila. O executor depende da configuração e ativação segura do GitHub Actions." };
  } catch {
    return { status: "error", message: "Falha inesperada ao solicitar a configuração logística." };
  }
}
