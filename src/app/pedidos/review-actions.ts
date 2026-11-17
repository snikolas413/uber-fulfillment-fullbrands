"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ReviewFields = {
  name: string; email: string; postal_code: string; street: string; number: string;
  complement: string; district: string; city: string; state: string;
};
export type ReviewData = ReviewFields & { version: string; lastError: string | null };
type Result = { status: "success" | "error"; message: string; data?: ReviewData };

async function context() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sua sessão expirou. Entre novamente.");
  const { data: profile } = await client.from("user_profiles").select("role,is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) {
    throw new Error("Seu perfil não tem permissão para corrigir pedidos.");
  }
  return client;
}

export async function loadReviewOrderAction(id: string): Promise<Result> {
  try {
    const client = await context();
    const { data: row, error } = await client.from("fulfillments")
      .select("status,omie_order_id,updated_at,delivery_recipient_name,customer_email,omie_last_error,recipients(full_name,email),delivery_addresses(postal_code,street,number,complement,district,city,state)")
      .eq("id", id).maybeSingle();
    if (error || !row) return { status: "error", message: "Não foi possível carregar os dados do pedido." };
    if (row.omie_order_id || !["order_pending", "error"].includes(row.status)) {
      return { status: "error", message: "A edição está disponível somente para pedidos em Revisar, sem vínculo com o Omie." };
    }
    const recipient = Array.isArray(row.recipients) ? row.recipients[0] : row.recipients;
    const address = Array.isArray(row.delivery_addresses) ? row.delivery_addresses[0] : row.delivery_addresses;
    if (!recipient || !address) return { status: "error", message: "Destinatário ou endereço indisponível." };
    return { status: "success", message: "", data: {
      ...address, complement: address.complement ?? "", name: row.delivery_recipient_name ?? recipient.full_name,
      email: row.customer_email ?? recipient.email ?? "", version: row.updated_at, lastError: row.omie_last_error,
    } };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Não foi possível carregar o pedido." };
  }
}

export async function saveReviewOrderAction(id: string, version: string, fields: ReviewFields): Promise<Result> {
  try {
    const client = await context();
    const { error } = await client.rpc("save_reviewed_fulfillment", {
      p_id: id, p_expected_updated_at: version, p_fields: fields,
    });
    if (error) {
      const message = error.message;
      if (message.includes("ORDER_CHANGED")) return { status: "error", message: "O pedido mudou desde a abertura. Feche e abra a edição novamente." };
      if (message.includes("SEND_IN_PROGRESS")) return { status: "error", message: "O envio deste pedido está em andamento. Aguarde o resultado antes de editar." };
      if (message.includes("NOT_REVIEWABLE")) return { status: "error", message: "Este pedido já mudou de situação e não pode ser editado aqui." };
      if (message.includes("INVALID_REVIEW_FIELDS")) return { status: "error", message: "Confira os campos e seus limites: nome, rua, bairro e complemento até 60 caracteres; número até 10; CEP com 8 dígitos; cidade sem UF; e-mail válido." };
      return { status: "error", message: "Não foi possível salvar a correção. Confira a atualização do banco e tente novamente." };
    }
    revalidatePath("/pedidos");
    return { status: "success", message: "Correções salvas. Feche a edição e use Enviar ao Omie quando quiser enviar este pedido." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Não foi possível salvar o pedido." };
  }
}
