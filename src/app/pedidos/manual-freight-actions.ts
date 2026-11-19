"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callOmie } from "@/lib/omie/client";
import { inspectManualFreight } from "@/lib/omie/manual-freight";
import type { OmieActionResult } from "./omie-actions";

export async function confirmManualFreightAction(id: string, confirmed = false): Promise<OmieActionResult> {
  try {
    if (confirmed !== true || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("Confirme que selecionou Correios + Mini Envios grátis no Omie para este pedido.");
    }
    const db = await createSupabaseServerClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
    const { data: profile, error: profileError } = await db.from("user_profiles").select("role,is_active").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) throw new Error("Seu perfil não permite liberar frete.");
    const { data: row, error } = await db.from("fulfillments").select("id,status,updated_at,omie_order_id,omie_send_started_at").eq("id", id).maybeSingle();
    if (error || !row?.omie_order_id || !["order_created", "billing_pending"].includes(row.status) ||
      (row.omie_send_started_at && Date.parse(row.omie_send_started_at) > Date.now() - 900_000)) {
      throw new Error("Pedido indisponível para liberação. Atualize a situação no Omie.");
    }
    const response = await callOmie<{ pedido_venda_produto?: Parameters<typeof inspectManualFreight>[0] }>(
      "/produtos/pedido/", "ConsultarPedido", { codigo_pedido: row.omie_order_id });
    const freight = inspectManualFreight(response.pedido_venda_produto, row.omie_order_id, "UFB-" + id.replaceAll("-", ""));
    const validation = await callOmie<{ cCodStatus?: string; cDescStatus?: string }>(
      "/produtos/pedidovendafat/", "ValidarPedidoVenda", { nCodPed: row.omie_order_id });
    if (String(validation.cCodStatus ?? "") !== "0") throw new Error(validation.cDescStatus || "O Omie não validou o pedido para faturamento.");
    const saved = await db.rpc("confirm_manual_freight", { p_id: id, p_expected_updated_at: row.updated_at,
      p_order_id: row.omie_order_id, p_confirmed: true, p_freight: freight });
    if (saved.error) throw new Error("A liberação não foi salva: o pedido mudou, já tem emissão registrada ou possui etiqueta em andamento. Atualize a página e confira a situação.");
    revalidatePath("/faturamento"); revalidatePath("/pedidos"); revalidatePath("/expedicao");
    return { status: "success", message: "Ajuste conferido no Omie e frete liberado na aplicação. Nenhuma emissão foi solicitada." };
  } catch (error) {
    const retryAt = (error as { retryAt?: unknown } | null)?.retryAt;
    return { status: "error", message: error instanceof Error ? error.message : "Não foi possível conferir o ajuste de frete.",
      ...(typeof retryAt === "number" && Number.isFinite(retryAt) ? { retryAt } : {}) };
  }
}
