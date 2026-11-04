"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OrderActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const initialState: OrderActionState = { status: "idle", message: "" };

export async function prepareOrderAction(
  _previousState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return { status: "error", message: "Sua sessão expirou. Entre novamente para continuar." };
    }

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role, is_active")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) {
      return { status: "error", message: "Seu perfil não tem permissão para preparar pedidos." };
    }

    const recipientId = String(formData.get("recipient_id") ?? "").trim();
    const deliveryAddressId = String(formData.get("delivery_address_id") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim();
    const purchaseOrder = String(formData.get("customer_purchase_order") ?? "").trim();
    const customerEmail = String(formData.get("customer_email") ?? "").trim().toLowerCase();
    const quantity = Number(formData.get("quantity"));
    const unitPrice = Number(String(formData.get("unit_price") ?? "").replace(",", "."));

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(recipientId) || !uuidPattern.test(deliveryAddressId)) {
      return { status: "error", message: "Selecione um destinatário e endereço válidos." };
    }
    if (!uuidPattern.test(idempotencyKey)) {
      return { status: "error", message: "A sessão do formulário expirou. Feche e abra a preparação novamente." };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      return { status: "error", message: "A quantidade deve ser um número inteiro entre 1 e 999." };
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 999999.99) {
      return { status: "error", message: "Informe um valor unitário maior que zero." };
    }
    if (purchaseOrder.length > 30) {
      return { status: "error", message: "A referência do pedido de compra aceita até 30 caracteres." };
    }
    if (customerEmail.length > 160 || (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
      return { status: "error", message: "Informe um e-mail válido para o envio da NF-e." };
    }

    const { error } = await supabase.rpc("prepare_uber_fulfillment", {
      p_recipient_id: recipientId,
      p_delivery_address_id: deliveryAddressId,
      p_idempotency_key: idempotencyKey,
      p_customer_purchase_order: purchaseOrder || null,
      p_customer_email: customerEmail || null,
      p_quantity: quantity,
      p_unit_price: unitPrice,
    });

    if (error) {
      if (error.code === "23505") {
        return { status: "error", message: "Esta preparação já foi registrada. Atualize a página para conferir o pedido." };
      }
      if (error.code === "PGRST202" || error.message.includes("prepare_uber_fulfillment")) {
        return { status: "error", message: "A atualização do banco ainda não foi aplicada. O cadastro será liberado após a publicação da migration." };
      }
      if (error.message.includes("INVALID_CUSTOMER_EMAIL")) {
        return { status: "error", message: "O e-mail informado é inválido. Corrija o endereço antes de continuar." };
      }
      if (error.message.includes("ADDRESS_INVALID")) {
        return { status: "error", message: "O endereço está marcado como inválido. Corrija o cadastro antes de preparar o pedido." };
      }
      if (error.message.includes("ADDRESS_NOT_FOUND")) {
        return { status: "error", message: "O endereço selecionado não pertence a este destinatário." };
      }
      if (error.message.includes("FORBIDDEN")) {
        return { status: "error", message: "Seu perfil não tem permissão para preparar pedidos." };
      }
      console.error("Erro ao preparar pedido:", error);
      return { status: "error", message: "Não foi possível preparar o pedido. Confira os dados e tente novamente." };
    }

    revalidatePath("/pedidos");
    revalidatePath("/");
    return { status: "success", message: "Pedido preparado localmente. Nenhum pedido foi enviado ao Omie." };
  } catch (error) {
    console.error("Falha inesperada ao preparar pedido:", error);
    return { status: "error", message: "Ocorreu um erro inesperado ao preparar o pedido." };
  }
}

export const orderInitialState = initialState;
