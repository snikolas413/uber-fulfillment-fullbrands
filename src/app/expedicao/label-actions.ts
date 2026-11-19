"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callOmie } from "@/lib/omie/client";
import { readShippingInvoice } from "@/lib/omie/shipping-invoice";
import { downloadOmieLabel } from "@/lib/omie/label-download";
import { composeShippingLabel } from "@/lib/omie/shipping-label-pdf";
import { getLabelSources, type LabelState } from "@/lib/omie/generate-shipping-label";
import { isMiniEnviosName } from "@/lib/omie/freight-selection";

export type LabelResult = { status: "success" | "error"; message: string; url?: string; retryAt?: number };
export async function generateShippingLabelAction(id: string, confirmed = false, confirmUnknownRetry = false): Promise<LabelResult> {
  let reportFailure: ((message: string, retryAt?: number) => Promise<void>) | undefined;
  try {
    if (confirmed !== true || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Confirme o pedido para gerar a etiqueta.");
    const db = await createSupabaseServerClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
    const { data: profile, error: profileError } = await db.from("user_profiles").select("role,is_active").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) throw new Error("Seu perfil não tem permissão para gerar etiquetas.");
    const { data: row, error } = await db.from("fulfillments").select("id,status,omie_order_id").eq("id", id).maybeSingle();
    if (error || !row?.omie_order_id || !["billing_pending", "billed", "shipping_pending", "label_ready", "shipped"].includes(row.status)) throw new Error("Pedido indisponível para expedição.");
    reportFailure = async (message, retryAt) => {
      const at = new Date().toISOString();
      const { error: saveError } = await db.from("shipments").update({ label_last_error: message.slice(0, 1200), label_error_at: at }).eq("fulfillment_id", id);
      const { error: auditError } = await db.from("audit_logs").insert({ actor_id: auth.user.id, entity_type: "fulfillment", entity_id: id,
        action: "shipping.label_failed", source: "application", after_summary: { message: message.slice(0, 1200), ...(retryAt ? { retry_at: new Date(retryAt).toISOString() } : {}) } });
      if (saveError || auditError) throw new Error("Não foi possível registrar o aviso da etiqueta.");
    };
    const invoice = await readShippingInvoice(callOmie, Number(row.omie_order_id), "UFB-" + id.replaceAll("-", ""));
    const { error: invoiceError } = await db.from("invoices").upsert({ fulfillment_id: id, access_key: invoice.key, omie_invoice_number: invoice.number,
      series: invoice.series, status: "006", ...(invoice.issuedAt ? { issued_at: invoice.issuedAt } : {}) }, { onConflict: "fulfillment_id" });
    const { error: syncError } = await db.from("fulfillments").update({ status: "billed" }).eq("id", id).eq("status", "billing_pending");
    if (invoiceError || syncError) throw new Error("Não foi possível sincronizar a NF-e autorizada antes da expedição.");
    const { error: initError } = await db.from("shipments").upsert({ fulfillment_id: id }, { onConflict: "fulfillment_id", ignoreDuplicates: true });
    if (initError) throw new Error("Não foi possível iniciar o controle da etiqueta.");
    const { data: shipment, error: shipmentError } = await db.from("shipments")
      .select("label_generation_state,label_source_urls,label_invoice_key,label_storage_path,label_requested_at,tracking_code,package_count,service_code,carrier_id")
      .eq("fulfillment_id", id).single();
    if (shipmentError || !shipment) throw new Error("A atualização de etiquetas ainda não está disponível no banco.");
    if (shipment.label_invoice_key && shipment.label_invoice_key !== invoice.key) throw new Error("A NF-e do pedido mudou. Confira o documento antes de reimprimir a etiqueta.");
    const url = "/api/expedicao/" + id + "/etiqueta";
    if (shipment.label_generation_state === "ready" && shipment.label_storage_path) {
      await db.from("shipments").update({ label_last_error: null, label_error_at: null }).eq("fulfillment_id", id);
      return { status: "success", message: "Etiqueta já disponível para reimpressão.", url };
    }
    if (!(shipment.service_code === "04227" || isMiniEnviosName(shipment.service_code ?? "")) || Number(shipment.carrier_id) !== 2757271756) throw new Error("Confirme Correios + Mini Envios no pedido antes de gerar a etiqueta.");
    const volumes = Number(shipment.package_count ?? 1);
    if (!Number.isInteger(volumes) || volumes < 1 || volumes > 20) throw new Error("Confira a quantidade de volumes do pedido (1 a 20).");
    const retryUnknown = confirmUnknownRetry === true;
    if (retryUnknown) {
      if (shipment.label_generation_state !== "unknown") throw new Error("A etiqueta mudou de situação. Atualize a página antes de confirmar outra tentativa.");
      const response = await callOmie<{ pedido_venda_produto?: {
        cabecalho?: { codigo_pedido?: number; codigo_pedido_integracao?: string };
        infoCadastro?: { cancelado?: string; faturado?: string };
        frete?: { codigo_transportadora?: number; codigo_rastreio?: string; quantidade_volumes?: number };
      } }>("/produtos/pedido/", "ConsultarPedido", { codigo_pedido: row.omie_order_id });
      const current = response.pedido_venda_produto;
      if (!current || !current.cabecalho || current.cabecalho.codigo_pedido !== row.omie_order_id || current.cabecalho.codigo_pedido_integracao !== "UFB-" + id.replaceAll("-", "") ||
        current.infoCadastro?.cancelado !== "N" || current.infoCadastro?.faturado !== "S" ||
        current.frete?.codigo_transportadora !== Number(shipment.carrier_id) || !shipment.tracking_code ||
        current.frete?.codigo_rastreio?.trim() !== shipment.tracking_code || current.frete?.quantidade_volumes !== volumes) {
        throw new Error("O vínculo, o rastreio ou os volumes não foram confirmados no Omie. Sincronize o frete antes de autorizar outra tentativa.");
      }
    }
    const update = async (patch: Record<string, unknown>) => {
      const { error } = await db.from("shipments").update(patch).eq("fulfillment_id", id);
      if (error) throw new Error("Não foi possível salvar o resultado da etiqueta. Confira o Omie antes de repetir a geração.");
    };
    const sources = await getLabelSources(callOmie, Number(row.omie_order_id), {
      state: shipment.label_generation_state as LabelState, sources: shipment.label_source_urls as string[] | null,
      allowUnknownRetry: retryUnknown,
      async claim() {
        const requestedAt = new Date().toISOString();
        let claim = db.from("shipments").update({ label_generation_state: "processing", label_requested_at: requestedAt, label_invoice_key: invoice.key })
          .eq("fulfillment_id", id).eq("label_generation_state", retryUnknown ? "unknown" : "none");
        if (retryUnknown) claim = shipment.label_requested_at ? claim.eq("label_requested_at", shipment.label_requested_at) : claim.is("label_requested_at", null);
        const { data, error } = await claim.select("id").maybeSingle();
        if (error) throw new Error("Não foi possível reservar a geração da etiqueta.");
        if (data && retryUnknown) {
          const { error: auditError } = await db.from("audit_logs").insert({ actor_id: auth.user.id, entity_type: "fulfillment", entity_id: id,
            action: "shipping.label_retry_authorized", source: "application", after_summary: {
              previous_requested_at: shipment.label_requested_at, invoice_number: invoice.number, tracking_code: shipment.tracking_code,
              operator_confirmed: true, no_freight_requested: true, no_invoice_requested: true,
            } });
          if (auditError) {
            await db.from("shipments").update({ label_generation_state: "unknown" }).eq("fulfillment_id", id)
              .eq("label_generation_state", "processing").eq("label_requested_at", requestedAt);
            throw new Error("Não foi possível registrar a autorização. Nenhuma etiqueta foi solicitada; confira a situação do pedido.");
          }
        }
        return Boolean(data);
      },
      saveSources: urls => update({ label_source_urls: urls, label_generation_state: "sources_ready", label_invoice_key: invoice.key }),
      markUnknown: () => update({ label_generation_state: "unknown" }),
      markRejected: () => update({ label_generation_state: "none" }),
    });
    const bucket = db.storage.from("shipping-labels");
    const prefix = id + "/" + invoice.key;
    const pdfs = [];
    for (const [index, source] of sources.entries()) {
      const path = prefix + "/original-" + index + ".pdf";
      const stored = await bucket.download(path);
      const bytes = stored.data ? new Uint8Array(await stored.data.arrayBuffer()) : await downloadOmieLabel(source);
      if (!stored.data) {
        const { error } = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (error) throw new Error("Não foi possível preservar a etiqueta original. Tente recuperar o PDF novamente, sem gerar outra etiqueta.");
      }
      pdfs.push(bytes);
    }
    const combined = await composeShippingLabel(pdfs, invoice, volumes);
    const path = prefix + "/etiqueta-nfe-v1.pdf";
    const { error: uploadError } = await bucket.upload(path, combined, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error("O PDF foi montado, mas não pôde ser armazenado. Repita a montagem para recuperar o arquivo, sem nova geração no Omie.");
    await update({ label_storage_path: path, label_generation_state: "ready", label_last_error: null, label_error_at: null });
    const { error: statusError } = await db.from("fulfillments").update({ status: "label_ready" }).eq("id", id).in("status", ["billing_pending", "billed", "shipping_pending", "label_ready"]);
    if (statusError) throw new Error("A etiqueta foi salva, mas a sincronização local não foi concluída. Atualize o pedido.");
    await db.from("audit_logs").insert({ actor_id: auth.user.id, entity_type: "fulfillment", entity_id: id, action: "shipping.label_ready", source: "application",
      after_summary: { invoice_number: invoice.number, page_format: "100x150mm", volumes, original_preserved: true } });
    revalidatePath("/expedicao"); revalidatePath("/pedidos"); revalidatePath("/faturamento");
    return { status: "success", message: "Etiqueta dos Correios com NF-e pronta em 100 × 150 mm. Imprima em tamanho real (100%).", url };
  } catch (error) {
    let message = error instanceof Error ? error.message : "Não foi possível preparar a etiqueta.";
    const value = (error as { retryAt?: unknown } | null)?.retryAt;
    const retryAt = typeof value === "number" && Number.isFinite(value) ? value : undefined;
    if (reportFailure) {
      try { await reportFailure(message, retryAt); revalidatePath("/expedicao"); }
      catch { message += " O aviso não pôde ser salvo; mantenha este resultado para conferência."; }
    }
    return { status: "error", message, ...(retryAt ? { retryAt } : {}) };
  }
}
