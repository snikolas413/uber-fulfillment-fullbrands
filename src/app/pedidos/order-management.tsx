"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, ClipboardList, Search, MapPin, Package, Clock3, FileText,
  ShieldCheck, X, LoaderCircle, AlertCircle
} from "lucide-react";
import { prepareOrderAction } from "./actions";
import type { OrderActionState } from "./actions";
import { OmieActionButton } from "@/components/omie-action-button";
import { OmieShippingQueueButton } from "@/components/omie-shipping-queue-button";

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
  customer_purchase_order: string | null;
  customer_email: string | null;
  created_at: string;
  recipients: { full_name: string; email: string | null } | null;
  delivery_addresses: { city: string; state: string; postal_code: string } | null;
  fulfillment_items: OrderItem[];
};

const orderInitialState: OrderActionState = { status: "idle", message: "" };

const PRODUCT_REFERENCE = {
  code: "R18",
  name: "REMOTE BUTTON",
  ncm: "8517.62.99",
  cfop: "6.117",
  unit: "PC",
  defaultPrice: "107.97",
};

function latestAddress(recipient: OrderRecipient) {
  return [...(recipient.delivery_addresses ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function addressText(address: Address | null | undefined) {
  if (!address) return "Endereço não cadastrado";
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const extra = [address.complement, address.district].filter(Boolean).join(" · ");
  return [street, extra, `${address.city}/${address.state}`, address.postal_code].filter(Boolean).join(" · ");
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
              <thead><tr><th>DESTINATÁRIO</th><th>PRODUTO</th><th>REFERÊNCIA</th><th>ENDEREÇO</th><th>E-MAIL NF-E</th><th>TOTAL</th><th>STATUS</th><th>CRIADO EM</th><th>OMIE</th></tr></thead>
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
                      <td>{canWrite && draft.status === "ready" && <OmieActionButton fulfillmentId={draft.id} kind="send" size="small" />}{canWrite && (draft.status === "order_pending" || draft.status === "error") && <OmieActionButton fulfillmentId={draft.id} kind="send" size="small" />}{canWrite && ["order_created", "billing_pending", "billed", "shipping_pending"].includes(draft.status) && <OmieActionButton fulfillmentId={draft.id} kind="sync-order" size="small" />}{canWrite && draft.omie_order_id && ["order_created", "billing_pending", "billed", "shipping_pending"].includes(draft.status) && <OmieShippingQueueButton fulfillmentId={draft.id} />}{canWrite && draft.status === "shipping_pending" && <OmieActionButton fulfillmentId={draft.id} kind="sync-shipping" size="small" />}{!canWrite && "Somente consulta"}</td>
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
        <OrderDraftModal
          key={modalKey}
          idempotencyKey={modalKey}
          recipients={readyRecipients}
          onClose={closeModal}
          onSaved={() => { closeModal(); router.refresh(); }}
        />
      )}
    </div>
  );
}

function OrderDraftModal({
  idempotencyKey,
  recipients,
  onClose,
  onSaved,
}: {
  idempotencyKey: string;
  recipients: OrderRecipient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(prepareOrderAction, orderInitialState);
  const firstRecipient = recipients[0];
  const [recipientId, setRecipientId] = useState(firstRecipient?.id ?? "");
  const selectedRecipient = recipients.find((recipient) => recipient.id === recipientId) ?? null;
  const addresses = selectedRecipient?.delivery_addresses;
  const [addressId, setAddressId] = useState(latestAddress(firstRecipient ?? { id: "", full_name: "", document_number: null, email: null, delivery_addresses: [] })?.id ?? "");
  const [customerEmail, setCustomerEmail] = useState(firstRecipient?.email ?? "");

  const orderedAddresses = useMemo(() => [...(addresses ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  ), [addresses]);
  const selectedAddress = orderedAddresses.find((address) => address.id === addressId) ?? orderedAddresses[0] ?? null;

  useEffect(() => {
    if (state.status === "success") onSaved();
  }, [state.status, onSaved]);

  function changeRecipient(nextId: string) {
    setRecipientId(nextId);
    const recipient = recipients.find((item) => item.id === nextId);
    setAddressId(latestAddress(recipient ?? { id: "", full_name: "", document_number: null, email: null, delivery_addresses: [] })?.id ?? "");
    setCustomerEmail(recipient?.email ?? "");
  }

  return (
    <div className="recipient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="recipient-modal order-modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
        <div className="recipient-modal-header">
          <div><span className="section-kicker">NOVO PEDIDO LOCAL</span><h2 id="order-modal-title">Preparar pedido de venda</h2><p>Um pedido por destinatário, com endereço vinculado à expedição.</p></div>
          <button type="button" className="icon-action" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <form action={formAction} className="recipient-form">
          <input type="hidden" name="idempotency_key" value={idempotencyKey} />

          <div className="recipient-form-section"><strong>Destinatário e entrega</strong><span>O cliente do ERP será Uber do Brasil. O motorista fica como destinatário físico da entrega.</span></div>
          <div className="recipient-form-grid">
            <label className="field-wide">Motorista / destinatário *
              <select name="recipient_id" required value={recipientId} onChange={(event) => changeRecipient(event.target.value)}>
                {recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.full_name}</option>)}
              </select>
            </label>
            <label className="field-wide">Endereço para esta entrega *
              <select name="delivery_address_id" required value={selectedAddress?.id ?? ""} onChange={(event) => setAddressId(event.target.value)}>
                {orderedAddresses.map((address) => <option key={address.id} value={address.id}>{addressText(address)}</option>)}
              </select>
            </label>
          </div>
          {selectedAddress && (
            <div className={`order-address-preview order-address-preview-${selectedAddress.validation_status}`}>
              <MapPin size={15} />
              <div><strong>{selectedAddress.validation_status === "valid" ? "Endereço validado" : selectedAddress.validation_status === "invalid" ? "Endereço inválido" : selectedAddress.validation_status === "manual_review" ? "Endereço em revisão manual" : "Endereço pendente de validação"}</strong><small>{addressText(selectedAddress)}</small></div>
            </div>
          )}

          <div className="recipient-form-section recipient-address-section"><strong>E-mail para o cliente</strong><span>O endereço será preenchido na aba “E-mail para o Cliente” do pedido Omie para receber a NF-e. O envio automático de e-mail permanece desativado.</span></div>
          <div className="recipient-form-grid">
            <label className="field-wide">E-mail para o cliente (NF-e)<input name="customer_email" type="email" autoComplete="email" maxLength={160} value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="E-mail cadastrado no destinatário" /></label>
          </div>
          <div className="recipient-form-section recipient-address-section"><strong>Item do pedido</strong><span>Produto consultado no cadastro Omie. O valor é uma referência editável e exige conferência antes da integração.</span></div>
          <div className="order-product-card">
            <span className="order-product-icon"><Package size={20} /></span>
            <div><strong>{PRODUCT_REFERENCE.name}</strong><small>Código {PRODUCT_REFERENCE.code} · NCM {PRODUCT_REFERENCE.ncm} · Unidade {PRODUCT_REFERENCE.unit}</small><small>Cenário fiscal de referência: Venda para entrega futura · CFOP {PRODUCT_REFERENCE.cfop}</small></div>
          </div>
          <div className="recipient-form-grid order-pricing-grid">
            <label>Quantidade *<input name="quantity" type="number" required min={1} max={999} step={1} defaultValue={1} /></label>
            <label>Valor unitário (R$) *<input name="unit_price" type="number" required min="0.01" max="999999.99" step="0.01" defaultValue={PRODUCT_REFERENCE.defaultPrice} /></label>
            <label className="field-wide">Purchase Order Uber (opcional)<input name="customer_purchase_order" maxLength={30} placeholder="Ex.: 656083" /></label>
          </div>

          <div className="recipient-form-note"><ShieldCheck size={15} /> O rascunho é salvo no Supabase com chave de idempotência e auditoria. Nenhuma operação é enviada ao Omie.</div>
          {state.status === "error" && <div className="recipient-alert recipient-alert-error">{state.message}</div>}
          <div className="recipient-form-actions">
            <button type="button" className="recipient-cancel" onClick={onClose} disabled={pending}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={pending || !selectedAddress}>{pending ? <><LoaderCircle className="auth-spinner" size={15} /> Salvando...</> : <><Plus size={15} /> Salvar preparação</>}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
