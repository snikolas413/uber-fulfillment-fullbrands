"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, ClipboardList, Search, MapPin, Package, Clock3, FileText,
  AlertCircle
} from "lucide-react";
import { OrderBatchModal } from "./order-batch-modal";
import { OmieActionButton } from "@/components/omie-action-button";
import { ShippingEditor } from "@/app/expedicao/shipping-editor";

type Address = {
  id: string;
  postal_code: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
  validation_status: "pending" | "valid" | "invalid" | "manual_review";
  created_at: string;
};

export type OrderRecipient = {
  id: string;
  full_name: string;
  document_number: string | null;
  email: string | null;
  delivery_addresses: Address[];
};

type OrderItem = {
  product_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type OrderDraft = {
  id: string;
  status: string;
  omie_order_id: number | null;
  omie_order_number: string | null;
  omie_last_error: string | null;
  shipments: { carrier_id: string | null; package_count: number | null; freight_amount: number | null; estimated_delivery_date: string | null; service_modality: string | null } | { carrier_id: string | null; package_count: number | null; freight_amount: number | null; estimated_delivery_date: string | null; service_modality: string | null }[] | null;
  customer_purchase_order: string | null;
  customer_email: string | null;
  created_at: string;
  recipients: { full_name: string; email: string | null } | null;
  delivery_addresses: { city: string; state: string; postal_code: string } | null;
  fulfillment_items: OrderItem[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "Rascunho preparado",
    order_pending: "Aguardando envio ao Omie",
    order_created: "Pedido no Omie",
    billing_pending: "Aguardando faturamento",
    billed: "Faturado",
    shipping_pending: "Aguardando expedição",
    label_ready: "Etiqueta pronta",
    shipped: "Enviado",
    error: "Revisar erro",
    cancelled: "Cancelado",
  };
  return labels[status] ?? status;
}

export function OrderManagement({
  recipients,
  drafts,
  canWrite,
  loadError,
}: {
  recipients: OrderRecipient[];
  drafts: OrderDraft[];
  canWrite: boolean;
  loadError?: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [modalKey, setModalKey] = useState<string | null>(null);

  const readyRecipients = recipients.filter((recipient) =>
    (recipient.delivery_addresses ?? []).some((address) => address.validation_status !== "invalid"),
  );
  const totalDraftValue = drafts.reduce(
    (sum, draft) => sum + (draft.fulfillment_items ?? []).reduce((lineSum, item) => lineSum + Number(item.line_total ?? Number(item.quantity) * Number(item.unit_price)), 0),
    0,
  );
  const visibleDrafts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return drafts;
    return drafts.filter((draft) => [
      draft.recipients?.full_name ?? "",
      draft.omie_order_number ?? "",
      draft.customer_purchase_order ?? "",
      draft.fulfillment_items?.[0]?.product_code ?? "",
    ].join(" ").toLocaleLowerCase("pt-BR").includes(term));
  }, [drafts, search]);

  const openNewDraft = () => setModalKey(crypto.randomUUID());
  const closeModal = () => setModalKey(null);

  return (
    <div className="orders-page">
      <section className="welcome-row orders-welcome">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> OPERAÇÃO · PREPARAÇÃO DE PEDIDOS</div>
          <h1>Pedidos</h1>
          <p className="page-lead">Prepare um pedido por destinatário, confira os dados e deixe tudo pronto para integração com o Omie.</p>
        </div>
        {canWrite && <button type="button" className="primary-button" onClick={openNewDraft}><Plus size={17} /> Preparar pedido</button>}
      </section>

      <section className="orders-notice">
        <div className="orders-notice-icon"><AlertCircle size={17} /></div>
        <div>
          <strong>Integração Omie com ações controladas</strong>
          <p>Prepare o pedido localmente e use “Enviar ao Omie” quando os dados estiverem conferidos. A ação cria um pedido real no ERP; faturamento e emissão da NF-e permanecem em uma etapa separada.</p>
        </div>
      </section>

      <section className="orders-stats">
        <article className="recipient-stat"><span className="recipient-stat-icon"><ClipboardList size={17} /></span><div><strong>{drafts.length}</strong><small>Preparações registradas</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Package size={17} /></span><div><strong>{drafts.filter((draft) => draft.status === "ready").length}</strong><small>Aguardando integração Omie</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><FileText size={17} /></span><div><strong>{formatCurrency(totalDraftValue)}</strong><small>Valor total das preparações</small></div></article>
      </section>

      <section className="panel orders-panel">
        <div className="recipient-toolbar">
          <div><span className="section-kicker">FILA OPERACIONAL</span><h2>Pedidos preparados</h2></div>
          <label className="recipient-search"><Search size={16} /><input aria-label="Buscar pedidos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por motorista, PO ou código" /></label>
        </div>
        {loadError && <div className="recipient-alert recipient-alert-error">{loadError}</div>}
        {visibleDrafts.length ? (
          <div className="orders-table-wrap">
            <table className="orders-table">
              <thead><tr><th>DESTINATÁRIO</th><th>PRODUTO</th><th>REFERÊNCIA</th><th>ENDEREÇO</th><th>E-MAIL NF-E</th><th>TOTAL</th><th>STATUS</th><th>CRIADO EM</th><th>OMIE / FRETE</th></tr></thead>
              <tbody>
                {visibleDrafts.map((draft) => {
                  const item = draft.fulfillment_items?.[0];
                  return (
                    <tr key={draft.id}>
                      <td><strong>{draft.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>{draft.omie_order_number ? `Omie #${draft.omie_order_number}` : "Ainda sem número Omie"}</small></td>
                      <td><strong>{item?.description ?? "Produto não informado"}</strong><small>{item?.product_code ?? "Sem código"} · {item?.quantity ?? 0} un.</small></td>
                      <td>{draft.customer_purchase_order || "Não informada"}</td>
                      <td><span className="orders-address"><MapPin size={12} />{draft.delivery_addresses ? `${draft.delivery_addresses.city}/${draft.delivery_addresses.state} · ${draft.delivery_addresses.postal_code}` : "Sem endereço"}</span></td>
                      <td>{draft.customer_email || "Não informado"}</td>
                      <td><strong>{formatCurrency(Number(item?.line_total ?? Number(item?.quantity ?? 0) * Number(item?.unit_price ?? 0)))}</strong></td>
                      <td><span className={`order-status order-status-${draft.status}`}>{statusLabel(draft.status)}</span></td>
                      <td><span className="orders-date"><Clock3 size={12} />{formatDate(draft.created_at)}</span></td>
                      <td>
                        {canWrite && ["ready", "order_pending", "error"].includes(draft.status) && <OmieActionButton fulfillmentId={draft.id} kind="send" size="small" />}
                        {canWrite && ["order_created", "billing_pending", "billed"].includes(draft.status) && <OmieActionButton fulfillmentId={draft.id} kind="sync-order" size="small" />}
                        {canWrite && draft.omie_order_id && ["order_created", "billing_pending"].includes(draft.status) && <>
                          {draft.omie_last_error?.startsWith("Frete: ") && <OmieActionButton fulfillmentId={draft.id} kind="select-mini" size="small" />}
                          <ShippingEditor fulfillmentId={draft.id} current={(() => { const shipment = Array.isArray(draft.shipments) ? draft.shipments[0] : draft.shipments; return { carrierId: shipment?.carrier_id && /^\d+$/.test(shipment.carrier_id) ? Number(shipment.carrier_id) : null, packageCount: shipment?.package_count, freightAmount: shipment?.freight_amount, deliveryForecast: shipment?.estimated_delivery_date, modality: shipment?.service_modality }; })()} />
                        </>}
                        {!canWrite && "Somente consulta"}
                        {draft.omie_last_error && <small role="status" className="omie-action-result omie-action-result-warning">{draft.omie_last_error}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="recipient-empty">
            <span className="recipient-empty-icon"><ClipboardList size={24} /></span>
            <strong>{search ? "Nenhum pedido encontrado" : "Nenhum pedido preparado ainda"}</strong>
            <p>{search ? "Revise a busca ou tente outro termo." : "Selecione um destinatário cadastrado para preparar o primeiro pedido."}</p>
            {!search && canWrite && <button type="button" className="secondary-button" onClick={openNewDraft} disabled={!readyRecipients.length}><Plus size={15} /> Preparar primeiro pedido</button>}
            {!search && !readyRecipients.length && <small className="orders-empty-hint">Cadastre um destinatário com endereço antes de avançar.</small>}
          </div>
        )}
        <div className="recipient-table-footer"><span>{visibleDrafts.length} de {drafts.length} preparação(ões)</span><span>O envio cria um pedido real no Omie. O faturamento exige confirmação separada.</span></div>
      </section>

      {modalKey && (
        <OrderBatchModal
          key={modalKey}
          recipients={recipients}
          onClose={closeModal}
          onSaved={() => { router.refresh(); }}
        />
      )}
    </div>
  );
}
