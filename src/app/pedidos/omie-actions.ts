"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callOmie, OmieApiError, OmieConfigurationError } from "@/lib/omie/client";
import { selectMiniEnviosFreight, resolveCorreiosCarrier, FreightSelectionError, isMiniEnviosName } from "@/lib/omie/freight-selection";
import { invoiceExistingOrder, type BillingOutcome, type BillingControlState } from "@/lib/omie/invoice-order";

export type OmieActionResult = { status: "success" | "error" | "warning"; message: string };
type Recipient = { full_name: string; document_number: string | null; email: string | null; phone: string | null };
type Address = { street: string; number: string; complement: string | null; district: string; city: string; state: string; postal_code: string; validation_status: string };
type Item = { omie_product_id: number; product_code: string; description: string; ncm: string | null; cfop: string | null; unit: string; quantity: number; unit_price: number };
type Fulfillment = {
  id: string; status: string; omie_order_id: number | null; omie_order_number: string | null;
  omie_customer_id: number | null; omie_tax_scenario_id: number | null;
  customer_purchase_order: string | null; customer_email: string | null;
  omie_last_error?: string | null;
  recipients: Recipient | Recipient[] | null; delivery_addresses: Address | Address[] | null; fulfillment_items: Item[] | null;
};
type OmieInvoice = { chave_nfe?: string; numero_nfe?: string; serie_nfe?: string; protocolo?: string | number; status_nfe?: string; data_emissao?: string; danfe?: string; xml_distr?: string };
type OmieStatus = { codigo_pedido?: number; codigo_pedido_integracao?: string; numero_pedido?: string; etapa?: string; faturada?: string; cancelada?: string; ListaNfe?: OmieInvoice[] };
type OmieOrder = { codigo_pedido?: number; numero_pedido?: string; codigo_pedido_integracao?: string };
type OmiePedido = {
  pedido_venda_produto?: {
    frete?: {
      codigo_rastreio?: string; link_rastreio?: string; previsao_entrega?: string; valor_frete?: number;
      quantidade_volumes?: number; modalidade?: string; codigo_tipo_entrega?: number; codigo_transportadora?: number;
    };
  };
};

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
function integrationCode(id: string) { return "UFB-" + id.replace(/-/g, ""); }
function itemIntegrationCode(id: string) { return "UFB-" + id.replace(/-/g, "").slice(0, 25); }
function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date());
  const day = parts.find((p) => p.type === "day")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const year = parts.find((p) => p.type === "year")?.value;
  if (!day || !month || !year) throw new Error("Não foi possível definir a previsão do pedido.");
  return day + "/" + month + "/" + year;
}
function parseOmieDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (match) return match[3] + "-" + match[2] + "-" + match[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function errorMessage(error: unknown) {
  if (error instanceof OmieConfigurationError || error instanceof OmieApiError || error instanceof FreightSelectionError) return error.message;
  return "Falha de comunicação com o Omie. Consulte o status antes de tentar novamente.";
}
function isNotFound(error: unknown) {
  const message = error instanceof Error ? error.message.toLocaleLowerCase("pt-BR") : "";
  const code = error instanceof OmieApiError ? (error.code ?? "").toLocaleLowerCase("pt-BR") : "";
  return message.includes("não encontrado") || message.includes("nao encontrado") ||
    message.includes("não cadastrado") || message.includes("nao cadastrado") ||
    message.includes("not found") || code.includes("not_found") || code.includes("nao_encontrado");
}
async function context() {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
  const { data: profile, error } = await supabase.from("user_profiles").select("role, is_active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) {
    throw new Error("Seu perfil não tem permissão para executar operações do Omie.");
  }
  return { supabase, userId: auth.user.id };
}
async function load(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, id: string) {
  const { data, error } = await supabase.from("fulfillments")
    .select("id,status,omie_order_id,omie_order_number,omie_customer_id,omie_tax_scenario_id,customer_purchase_order,customer_email,omie_last_error,recipients(full_name,document_number,email,phone),delivery_addresses(street,number,complement,district,city,state,postal_code,validation_status),fulfillment_items(omie_product_id,product_code,description,ncm,cfop,unit,quantity,unit_price)")
    .eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Não foi possível carregar o pedido local.");
  return data as unknown as Fulfillment;
}
async function audit(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, id: string, action: string, summary: Record<string, unknown>) {
  const { error } = await supabase.from("audit_logs").insert({
    actor_id: userId, entity_type: "fulfillment", entity_id: id, action, after_summary: summary, source: "application",
  });
  if (error) console.error("Falha ao registrar auditoria Omie.");
}
async function statusFromOmie(row: Fulfillment) {
  return callOmie<OmieStatus>("/produtos/pedido/", "StatusPedido", {
    ...(row.omie_order_id ? { codigo_pedido: row.omie_order_id } : {}),
    codigo_pedido_integracao: integrationCode(row.id),
  });
}
function hasOmieOrder(status: OmieStatus) {
  return Boolean(status.codigo_pedido || status.numero_pedido || status.codigo_pedido_integracao);
}
async function reconcile(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, row: Fulfillment, status: OmieStatus): Promise<OmieActionResult> {
  const invoice = status.ListaNfe?.find((nfe) => nfe.numero_nfe || nfe.chave_nfe);
  const isInvoiced = status.faturada === "S" || Boolean(invoice?.numero_nfe || invoice?.chave_nfe);
  const cancelled = status.cancelada === "S";
  const stage = String(status.etapa ?? "");
  let next = row.status;
  if (cancelled) next = "cancelled";
  else if (row.status === "shipped") next = "shipped";
  else if (row.status === "label_ready") next = "label_ready";
  else if (isInvoiced) next = "billed";
  else if (stage === "50") next = "billing_pending";
  else if (stage === "70") next = "shipping_pending";
  else next = "order_created";

  const now = new Date().toISOString();
  const { error } = await supabase.from("fulfillments").update({
    status: next, omie_order_id: status.codigo_pedido ?? row.omie_order_id,
    omie_order_number: status.numero_pedido ?? row.omie_order_number,
    omie_last_sync_at: now, omie_last_error: row.omie_last_error?.startsWith("Frete: ") ? row.omie_last_error : null,
  }).eq("id", row.id);
  if (error) throw new Error("O Omie foi consultado, mas não foi possível atualizar o pedido local.");

  if (invoice && (invoice.numero_nfe || invoice.chave_nfe)) {
    const { error: invoiceError } = await supabase.from("invoices").upsert({
      fulfillment_id: row.id, omie_invoice_number: invoice.numero_nfe ?? null,
      series: invoice.serie_nfe ?? null, access_key: invoice.chave_nfe ?? null,
      protocol: invoice.protocolo == null ? null : String(invoice.protocolo),
      status: invoice.status_nfe ?? "faturada", issued_at: parseOmieDate(invoice.data_emissao),
      danfe_url: invoice.danfe ?? null, xml_available: Boolean(invoice.xml_distr),
    }, { onConflict: "fulfillment_id" });
    if (invoiceError) throw new Error("O status foi consultado, mas os dados da NF-e não puderam ser salvos.");
  }
  await audit(supabase, userId, row.id, "omie.order.synced", {
    omie_order_number: status.numero_pedido ?? row.omie_order_number,
    stage, invoiced: isInvoiced, cancelled, invoice_number_present: Boolean(invoice?.numero_nfe),
  });
  revalidatePath("/pedidos"); revalidatePath("/faturamento"); revalidatePath("/expedicao"); revalidatePath("/");
  return {
    status: "success",
    message: cancelled ? "O pedido está cancelado no Omie."
      : isInvoiced ? "Pedido sincronizado. Dados da NF-e recebidos do Omie."
      : "Pedido sincronizado. Etapa atual no Omie: " + (stage || "não informada") + ".",
  };
}
function validateOrder(row: Fulfillment) {
  const recipient = relation(row.recipients);
  const address = relation(row.delivery_addresses);
  const item = row.fulfillment_items?.[0];
  if (!recipient || !address || !item) throw new Error("O pedido não possui destinatário, endereço ou item válido.");
  if (address.validation_status === "invalid") throw new Error("O endereço está marcado como inválido.");
  const email = (row.customer_email ?? recipient.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Cadastre um e-mail no destinatário antes de enviar o pedido ao Omie.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("O e-mail para NF-e é inválido.");
  return { recipient, address, item, email };
}
async function includeOrder(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, row: Fulfillment, carrierId: number): Promise<OmieActionResult> {
  const { recipient, address, item, email } = validateOrder(row);
  const po = row.customer_purchase_order?.trim() ?? "";
  const city = address.city.trim().toLocaleUpperCase("pt-BR") + " (" + address.state.trim().toUpperCase() + ")";
  const result = await callOmie<OmieOrder>("/produtos/pedido/", "IncluirPedido", {
    cabecalho: {
      codigo_cliente: row.omie_customer_id ?? 2867720329,
      codigo_pedido_integracao: integrationCode(row.id),
      data_previsao: todayInSaoPaulo(), etapa: "10", codigo_parcela: "000",
      ...(row.omie_tax_scenario_id ? { codigo_cenario_impostos: row.omie_tax_scenario_id } : {}),
    },
    frete: { codigo_transportadora: carrierId },
    informacoes_adicionais: {
      codigo_categoria: "1.01.03", codigo_conta_corrente: 2611948369,
      numero_pedido_cliente: po || "", dados_adicionais_nf: po ? "Purchase Order #" + po + "|" : "",
      consumidor_final: "S", utilizar_emails: email, enviar_email: "N",
      outros_detalhes: {
        cNomeOd: recipient.full_name, cCnpjCpfOd: recipient.document_number ?? "",
        cEnderecoOd: address.street, cNumeroOd: address.number, cComplementoOd: address.complement ?? "",
        cBairroOd: address.district, cCEPOd: address.postal_code, cCidadeOd: city,
        cEstadoOd: address.state, cTelefoneOd: recipient.phone ?? "",
      },
    },
    det: [{
      ide: { codigo_item_integracao: itemIntegrationCode(row.id) },
      produto: {
        codigo_produto: item.omie_product_id, codigo: item.product_code, descricao: item.description,
        cfop: item.cfop ?? "6.117", ncm: item.ncm ?? "8517.62.99", unidade: item.unit,
        quantidade: Number(item.quantity), valor_unitario: Number(item.unit_price),
      },
      inf_adic: {
        ...(po ? { numero_pedido_compra: po.slice(0, 15) } : {}),
        nao_movimentar_estoque: "S", nao_gerar_financeiro: "S",
      },
    }],
  });
  const orderId = Number(result.codigo_pedido);
  const orderNumber = result.numero_pedido ? String(result.numero_pedido) : null;
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return { status: "warning", message: "O Omie respondeu à inclusão, mas não informou o código interno. Consulte a integração antes de qualquer nova tentativa." };
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from("fulfillments").update({
    status: "order_created", omie_order_id: orderId, omie_order_number: orderNumber,
    omie_submitted_at: now, omie_last_sync_at: now, omie_last_error: null,
  }).eq("id", row.id);
  if (error) return { status: "warning", message: "O Omie recebeu o pedido, mas não foi possível atualizar o registro local. Use a sincronização para reconciliar." };
  await audit(supabase, userId, row.id, "omie.order.created", {
    omie_order_id: orderId, omie_order_number: orderNumber, integration_code: integrationCode(row.id),
    email_present: Boolean(email), shipping_in_omie: true,
  });
  revalidatePath("/pedidos"); revalidatePath("/faturamento"); revalidatePath("/");
  const selected = await applyMiniEnviosFreight(supabase, userId, { ...row, status: "order_created", omie_order_id: orderId, omie_order_number: orderNumber });
  return { status: selected.status, message: "Pedido criado no Omie" + (orderNumber ? " com número " + orderNumber : "") + ". " + selected.message };
}

async function applyMiniEnviosFreight(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, row: Fulfillment): Promise<OmieActionResult> {
  let selected = false;
  const persistMessage = async (message: string | null) => {
    try {
      await supabase.from("fulfillments").update({ omie_last_error: message ? ("Frete: " + message).slice(0, 500) : null }).eq("id", row.id);
    } catch { console.error("Não foi possível registrar o resultado local da seleção de frete."); }
    revalidatePath("/pedidos");
  };
  try {
    if (!row.omie_order_id || !["order_created", "billing_pending"].includes(row.status)) {
      return { status: "warning", message: "O pedido precisa estar criado no Omie e ainda não faturado para selecionar o frete." };
    }
    const result = await selectMiniEnviosFreight(callOmie, row.omie_order_id, integrationCode(row.id));
    selected = true;
    await audit(supabase, userId, row.id, "omie.freight.selected", {
      omie_order_id: row.omie_order_id, freight_quote_id: result.quote.nIdFrete,
      service_code: result.quote.cTipoServico, service_name: result.quote.cDescricaoServico,
      carrier_id: result.carrierId, free_for_customer: true, quoted_amount: result.quote.nValorFrete,
      quoted_delivery_days: result.quote.nDiasEntrega,
    });
    const { error } = await supabase.from("shipments").upsert({
      fulfillment_id: row.id, carrier_id: String(result.carrierId), service_code: result.quote.cTipoServico,
      freight_amount: 0, package_count: result.freight?.quantidade_volumes ?? null,
      service_modality: result.freight?.modalidade ?? null, omie_last_sync_at: new Date().toISOString(),
    }, { onConflict: "fulfillment_id" });
    revalidatePath("/pedidos"); revalidatePath("/expedicao");
    const message = error ? "Mini Envios foi selecionado no Omie, mas a cópia local do frete não foi atualizada. Confira o ERP antes de repetir." : null;
    await persistMessage(message);
    return message ? { status: "warning", message }
      : { status: "success", message: "Opção Mini Envios selecionada e pedido consultado com frete grátis para o cliente." };
  } catch (error) {
    await audit(supabase, userId, row.id, "omie.freight.selection_pending", {
      omie_order_id: row.omie_order_id,
      outcome: selected ? "selected" : error instanceof FreightSelectionError ? error.outcome : "not_selected",
      message: errorMessage(error).slice(0, 500),
      quote_diagnostic: error instanceof FreightSelectionError ? error.diagnostic ?? null : null,
    }).catch(() => console.error("Não foi possível registrar a pendência de seleção de frete na auditoria."));
    const message = errorMessage(error) + " O pedido permanece criado; não reenvie a inclusão do pedido.";
    await persistMessage(message);
    return { status: "warning", message };
  }
}

export async function selectMiniEnviosFreightAction(id: string): Promise<OmieActionResult> {
  try {
    const { supabase, userId } = await context();
    return await applyMiniEnviosFreight(supabase, userId, await load(supabase, id));
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

export async function sendOrderToOmieAction(id: string, confirmRetry = false): Promise<OmieActionResult> {
  try {
    const { supabase, userId } = await context();
    let row = await load(supabase, id);
    validateOrder(row);
    if (["order_created", "billing_pending", "billed", "shipping_pending", "label_ready", "shipped"].includes(row.status)) {
      return { status: "warning", message: "Este pedido já avançou no Omie. Use a sincronização para consultar a situação." };
    }
    if (row.status === "order_pending" || row.status === "error") {
      try {
        const existing = await statusFromOmie(row);
        if (hasOmieOrder(existing)) {
          const reconciled = await reconcile(supabase, userId, row, existing);
          if (existing.cancelada === "S" || existing.faturada === "S" || existing.ListaNfe?.some((nfe) => nfe.numero_nfe || nfe.chave_nfe) ||
            !["10", "20", "30", "40", "50"].includes(String(existing.etapa))) return reconciled;
          const recovered = await load(supabase, id);
          // Finish freight for a recovered inclusion, without including the order again.
          return await applyMiniEnviosFreight(supabase, userId, recovered);
        }
      } catch (error) {
        if (!isNotFound(error)) {
          return { status: "error", message: "Não foi possível confirmar se o pedido já existe no Omie. Não será feita nova inclusão para evitar duplicidade. " + errorMessage(error) };
        }
      }
      if (!confirmRetry) return {
        status: "warning",
        message: "O Omie não localizou o código de integração. Confira o pedido no ERP e só então autorize uma nova tentativa.",
      };
    } else if (row.status !== "ready") {
      return { status: "error", message: "O status local não permite enviar este pedido ao Omie." };
    }

    const carrierId = await resolveCorreiosCarrier(callOmie);
    if (row.status === "ready") {
      const { data: lock, error } = await supabase.from("fulfillments").update({
        status: "order_pending", omie_last_error: null,
      }).eq("id", row.id).eq("status", "ready").select("id").maybeSingle();
      if (error || !lock) return { status: "warning", message: "O pedido mudou de situação. Atualize a tela antes de continuar." };
      row = { ...row, status: "order_pending" };
    } else {
      const { error } = await supabase.from("fulfillments").update({
        status: "order_pending", omie_last_error: null,
      }).eq("id", row.id);
      if (error) throw new Error("Não foi possível reservar a nova tentativa de envio.");
      row = { ...row, status: "order_pending" };
    }

    try {
      return await includeOrder(supabase, userId, row, carrierId);
    } catch (error) {
      const message = errorMessage(error);
      await supabase.from("fulfillments").update({
        status: "order_pending", omie_last_error: message.slice(0, 500),
      }).eq("id", row.id);
      return { status: "error", message: message + " O pedido ficou pendente de reconciliação; não repita o envio sem consultar o Omie." };
    }
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

export async function syncOmieOrderAction(id: string): Promise<OmieActionResult> {
  try {
    const { supabase, userId } = await context();
    const row = await load(supabase, id);
    if (!row.omie_order_id && !["order_pending", "order_created", "billing_pending", "billed", "shipping_pending", "label_ready", "shipped"].includes(row.status)) {
      return { status: "error", message: "O pedido ainda não possui referência de integração com o Omie." };
    }
    const status = await statusFromOmie(row);
    if (!hasOmieOrder(status)) return { status: "warning", message: "O Omie não retornou esse pedido. Confira o ERP antes de reenviar." };
    return await reconcile(supabase, userId, row, status);
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

export async function invoiceOrderAction(id: string, confirmed = false): Promise<OmieActionResult & { billingOutcome?: BillingOutcome }> {
  try {
    if (!confirmed) return { status: "error", message: "Confirme os pedidos selecionados antes de solicitar o faturamento." };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { status: "error", message: "Pedido inválido." };
    const { supabase, userId } = await context();
    const row = await load(supabase, id);
    if (!row.omie_order_id || !row.omie_order_number || !["order_created", "billing_pending", "billed"].includes(row.status)) return { status: "error", message: "O pedido precisa estar criado no Omie para ser faturado." };
    if (row.omie_last_error?.startsWith("Frete: ")) return { status: "warning", message: "Resolva a pendência de frete deste pedido antes de faturar." };
    const { data: shipment, error: shipmentError } = await supabase.from("shipments").select("carrier_id,service_code,freight_amount").eq("fulfillment_id", id).maybeSingle();
    const carrierId = Number(shipment?.carrier_id);
    if (shipmentError || !shipment || !Number.isSafeInteger(carrierId) || carrierId <= 0 || shipment.freight_amount == null || Number(shipment.freight_amount) !== 0 ||
      !(shipment.service_code === "04227" || isMiniEnviosName(shipment.service_code))) return { status: "warning", message: "Confirme Mini Envios com frete grátis antes de faturar este pedido." };
    let claimId: string | null = null;
    const claim = async () => {
      const inserted = await supabase.from("invoices").insert({ fulfillment_id: id, status: "billing_processing" }).select("id").maybeSingle();
      if (!inserted.error && inserted.data) { claimId = inserted.data.id; return true; }
      if (inserted.error?.code !== "23505") throw new Error("Não foi possível reservar o faturamento deste pedido.");
      // A unique fulfillment_id prevents concurrent requests; only a pre-emission refusal can be retried.
      const retried = await supabase.from("invoices").update({ status: "billing_processing" }).eq("fulfillment_id", id)
        .eq("status", "billing_rejected").is("omie_invoice_number", null).is("access_key", null).select("id").maybeSingle();
      if (retried.error) throw new Error("Não foi possível conferir a reserva de faturamento.");
      claimId = retried.data?.id ?? null;
      return Boolean(claimId);
    };
    const settle = async (state: BillingControlState) => {
      if (!claimId) throw new Error("Reserva de faturamento não confirmada.");
      const { error } = await supabase.from("invoices").update({ status: state }).eq("id", claimId)
        .in("status", ["billing_processing", "billing_submitted"]).is("omie_invoice_number", null).is("access_key", null);
      if (error) throw new Error("Não foi possível salvar o controle de faturamento.");
    };
    const result = await invoiceExistingOrder({ request: callOmie, orderId: row.omie_order_id, integrationCode: integrationCode(id), carrierId, claim, settle });
    let message = result.message;
    let status: OmieActionResult["status"] = result.outcome === "confirmed" ? "success" : "warning";
    if (result.snapshot) {
      try { await reconcile(supabase, userId, row, result.snapshot); }
      catch { message += " Não foi possível atualizar a cópia local. Consulte o Omie antes de repetir."; status = "warning"; }
    }
    await audit(supabase, userId, id, "omie.invoice.result", { omie_order_id: row.omie_order_id, outcome: result.outcome, message: message.slice(0, 500) });
    await supabase.from("fulfillments").update({ omie_last_error: status === "success" ? null : ("Faturamento: " + message).slice(0, 500) }).eq("id", id);
    revalidatePath("/faturamento"); revalidatePath("/pedidos");
    return { status, message, billingOutcome: result.outcome };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

export async function syncOmieShippingAction(id: string): Promise<OmieActionResult> {
  try {
    const { supabase, userId } = await context();
    const row = await load(supabase, id);
    if (!row.omie_order_id) return { status: "error", message: "O pedido ainda não possui número interno Omie." };
    const response = await callOmie<OmiePedido>("/produtos/pedido/", "ConsultarPedido", { codigo_pedido: row.omie_order_id });
    const freight = response.pedido_venda_produto?.frete;
    if (!freight) return { status: "warning", message: "O pedido foi localizado, mas ainda não há informações de expedição no Omie." };

    const tracking = freight.codigo_rastreio?.trim() || null;
    const trackingUrl = freight.link_rastreio?.trim() || null;
    const eta = parseOmieDate(freight.previsao_entrega);
    const now = new Date().toISOString();
    const { error: shipmentError } = await supabase.from("shipments").upsert({
      fulfillment_id: row.id,
      carrier_id: freight.codigo_transportadora ? String(freight.codigo_transportadora) : null,
      service_code: freight.codigo_tipo_entrega ? String(freight.codigo_tipo_entrega) : null,
      tracking_code: tracking, tracking_url: trackingUrl, estimated_delivery_date: eta,
      package_count: freight.quantidade_volumes ?? null, service_modality: freight.modalidade ?? null,
      freight_amount: freight.valor_frete ?? null, status: tracking ? "label_ready" : "shipping_pending",
      omie_last_sync_at: now,
    }, { onConflict: "fulfillment_id" });
    if (shipmentError) throw new Error("Dados de expedição recebidos, mas não foi possível salvá-los.");
    if (!["shipped", "cancelled"].includes(row.status)) {
      const { error } = await supabase.from("fulfillments").update({
        status: tracking ? "label_ready" : "shipping_pending", omie_last_sync_at: now,
      }).eq("id", row.id);
      if (error) throw new Error("O frete foi sincronizado, mas o status local não foi atualizado.");
    }
    await audit(supabase, userId, row.id, "omie.shipping.synced", {
      tracking_code_present: Boolean(tracking), tracking_url_present: Boolean(trackingUrl),
      freight_amount: freight.valor_frete ?? null, estimated_delivery_date: eta,
      package_count: freight.quantidade_volumes ?? null, correios_api_called_by_application: false,
    });
    revalidatePath("/expedicao"); revalidatePath("/pedidos"); revalidatePath("/");
    return tracking
      ? { status: "success", message: "Rastreio e frete atualizados a partir do Omie. A etiqueta continua no fluxo do próprio ERP." }
      : { status: "success", message: "Frete sincronizado do Omie. O código de rastreio ainda não foi registrado no ERP." };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}
