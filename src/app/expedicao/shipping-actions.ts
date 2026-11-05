"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callOmie } from "@/lib/omie/client";

type ShippingInput = {
  carrierId: number;
  packageDescription: string;
  packageCount: number;
  freightAmount: number;
  deliveryForecast: string;
  modality: "0" | "1" | "2";
  confirmed?: boolean;
};

type OmieOrderResponse = {
  pedido_venda_produto?: {
    cabecalho?: {
      codigo_pedido?: number;
      codigo_pedido_integracao?: string;
      numero_pedido?: string;
    };
    frete?: {
      codigo_transportadora?: number;
      especie_volumes?: string;
      quantidade_volumes?: number;
      valor_frete?: number;
      previsao_entrega?: string;
      modalidade?: string;
    };
    infoCadastro?: {
      faturado?: string;
      cancelado?: string;
      autorizado?: string;
    };
  };
};

type ActionResult =
  | { status: "success"; message: string; current?: Record<string, unknown> }
  | { status: "error" | "warning"; message: string };

async function authorizedContext() {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) {
    throw new Error("Seu perfil não tem permissão para operar o frete.");
  }
  return { supabase, userId: auth.user.id };
}

async function loadLinkedOrder(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, id: string) {
  const { data, error } = await supabase
    .from("fulfillments")
    .select("id,status,omie_order_id,omie_order_number")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("Pedido local não encontrado.");
  if (!data.omie_order_id) throw new Error("O pedido ainda não possui ID no Omie. Sincronize antes de continuar.");
  if (["cancelled", "shipped"].includes(data.status)) {
    throw new Error("Este pedido está cancelado ou enviado e não pode receber alteração logística por aqui.");
  }
  return data;
}

async function readOmieOrder(orderId: number): Promise<NonNullable<OmieOrderResponse["pedido_venda_produto"]>> {
  const response = await callOmie<OmieOrderResponse>(
    "/produtos/pedido/",
    "ConsultarPedido",
    { codigo_pedido: orderId },
  );
  const order = response.pedido_venda_produto;
  if (!order?.cabecalho?.codigo_pedido) throw new Error("O Omie não confirmou o pedido informado.");
  if (order.infoCadastro?.cancelado === "S") throw new Error("O pedido está cancelado no Omie.");
  if (order.infoCadastro?.faturado === "S") throw new Error("O pedido já está faturado. A alteração de frete foi bloqueada.");
  return order;
}

function validateInput(input: ShippingInput) {
  if (!["0", "1", "2"].includes(input.modality)) throw new Error("Selecione quem será responsável pelo frete.");
  if (!Number.isInteger(input.carrierId) || input.carrierId <= 0) throw new Error("Selecione uma transportadora válida.");
  if (!input.packageDescription.trim() || input.packageDescription.trim().length > 60) {
    throw new Error("Informe a embalagem com até 60 caracteres.");
  }
  if (!Number.isInteger(input.packageCount) || input.packageCount < 1 || input.packageCount > 999) {
    throw new Error("A quantidade de volumes deve ser um inteiro entre 1 e 999.");
  }
  if (!Number.isFinite(input.freightAmount) || input.freightAmount < 0 || input.freightAmount > 999999.99) {
    throw new Error("Informe um valor de frete válido.");
  }
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(input.deliveryForecast)) {
    throw new Error("A previsão deve estar no formato DD/MM/AAAA.");
  }
  const [day, month, year] = input.deliveryForecast.split("/").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("A data de previsão informada não existe.");
  }
}

export async function previewOmieShippingAction(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorizedContext();
    const row = await loadLinkedOrder(supabase, id);
    const order = await readOmieOrder(row.omie_order_id!);
    const freight = order.frete ?? {};
    return {
      status: "success",
      message: "Prévia consultada. Nenhuma alteração foi enviada ao Omie.",
      current: {
        orderNumber: order.cabecalho?.numero_pedido ?? row.omie_order_number,
        carrierId: freight.codigo_transportadora ?? null,
        packageDescription: freight.especie_volumes ?? null,
        packageCount: freight.quantidade_volumes ?? null,
        freightAmount: freight.valor_frete ?? null,
        deliveryForecast: freight.previsao_entrega ?? null,
        modality: freight.modalidade ?? null,
      },
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Não foi possível consultar o pedido no Omie." };
  }
}

/**
 * Atualiza somente os dados da estrutura frete de um pedido já existente.
 * A gravação exige confirmação explícita do usuário e nunca inclui/fatura/envia pedido.
 */
export async function updateOmieShippingAction(id: string, input: ShippingInput): Promise<ActionResult> {
  try {
    if (input.confirmed !== true) return { status: "warning", message: "Confirme os dados do frete antes de gravar." };
    validateInput(input);

    const { supabase, userId } = await authorizedContext();
    const row = await loadLinkedOrder(supabase, id);
    const before = await readOmieOrder(row.omie_order_id!);
    const integrationCode = before.cabecalho?.codigo_pedido_integracao;
    const expectedIntegrationCode = "UFB-" + id.replace(/-/g, "");
    if (!integrationCode || integrationCode !== expectedIntegrationCode) {
      throw new Error("O código de integração do pedido no Omie não corresponde ao pedido local. Alteração bloqueada para evitar atingir outro registro.");
    }

    await callOmie<Record<string, unknown>>(
      "/produtos/pedido/",
      "AlterarPedidoVenda",
      {
        cabecalho: {
          codigo_pedido: row.omie_order_id,
          codigo_pedido_integracao: integrationCode,
        },
        frete: {
          codigo_transportadora: input.carrierId,
          modalidade: input.modality,
          especie_volumes: input.packageDescription.trim(),
          quantidade_volumes: input.packageCount,
          valor_frete: Math.round(input.freightAmount * 100) / 100,
          previsao_entrega: input.deliveryForecast,
        },
      },
    );

    const after = await readOmieOrder(row.omie_order_id!);
    const saved = after.frete ?? {};
    const verified =
      saved.codigo_transportadora === input.carrierId &&
      saved.modalidade === input.modality &&
      saved.especie_volumes === input.packageDescription.trim() &&
      saved.quantidade_volumes === input.packageCount &&
      Number(saved.valor_frete ?? -1) === Math.round(input.freightAmount * 100) / 100 &&
      saved.previsao_entrega === input.deliveryForecast;

    if (!verified) {
      throw new Error("O Omie recebeu a solicitação, mas a conferência posterior não confirmou todos os campos. Consulte o pedido no ERP antes de tentar novamente.");
    }

    const { error: shipmentError } = await supabase.from("shipments").upsert({
      fulfillment_id: id,
      carrier_id: String(input.carrierId),
      package_count: input.packageCount,
      service_modality: input.modality,
      freight_amount: Math.round(input.freightAmount * 100) / 100,
      estimated_delivery_date: (() => {
        const [day, month, year] = input.deliveryForecast.split("/");
        return `${year}-${month}-${day}`;
      })(),
      omie_last_sync_at: new Date().toISOString(),
    }, { onConflict: "fulfillment_id" });
    if (shipmentError) throw new Error("O frete foi atualizado no Omie, mas não foi possível sincronizar os dados locais. Use Sincronizar frete antes de repetir a operação.");

    const { error: auditError } = await supabase.from("audit_logs").insert({
      actor_id: userId,
      entity_type: "fulfillment",
      entity_id: id,
      action: "omie.shipping.updated",
      before_summary: {
        carrier_id: before.frete?.codigo_transportadora ?? null,
        package_description: before.frete?.especie_volumes ?? null,
        package_count: before.frete?.quantidade_volumes ?? null,
        freight_amount: before.frete?.valor_frete ?? null,
        delivery_forecast: before.frete?.previsao_entrega ?? null,
      },
      after_summary: {
        carrier_id: input.carrierId,
        package_description: input.packageDescription.trim(),
        package_count: input.packageCount,
        freight_amount: Math.round(input.freightAmount * 100) / 100,
        delivery_forecast: input.deliveryForecast,
        modality: input.modality,
      },
      source: "application",
    });
    if (auditError) console.error("Falha ao registrar auditoria da atualização logística.");

    revalidatePath("/expedicao");
    revalidatePath("/pedidos");
    return {
      status: "success",
      message: "Frete e embalagem atualizados no pedido existente do Omie e conferidos por nova consulta. Cotação, etiqueta e postagem continuam no Omie.",
      current: {
        orderNumber: after.cabecalho?.numero_pedido ?? row.omie_order_number,
        carrierId: saved.codigo_transportadora,
        packageDescription: saved.especie_volumes,
        packageCount: saved.quantidade_volumes,
        freightAmount: saved.valor_frete,
        deliveryForecast: saved.previsao_entrega,
        modality: saved.modalidade,
      },
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Falha ao atualizar o frete no Omie." };
  }
}
