"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Package, Search, X } from "lucide-react";
import { prepareOrderAction } from "./actions";
import type { OrderRecipient } from "./order-management";
import { ORDER_REFERENCE } from "@/lib/omie/order-reference";
import { defaultDeliveryAddress, runPreparationBatch, type PreparationResult } from "@/lib/order-preparation";

type Choice = { addressId: string; email: string; key: string };
const emailValid = (value: string) => value.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function OrderBatchModal({ recipients: initialRecipients, onClose, onSaved }: {
  recipients: OrderRecipient[]; onClose: () => void; onSaved: () => void;
}) {
  const [recipients] = useState(initialRecipients);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(recipients.map(recipient => [recipient.id, {
    addressId: defaultDeliveryAddress(recipient.delivery_addresses)?.id ?? "", email: recipient.email ?? "", key: crypto.randomUUID(),
  }])));
  const [results, setResults] = useState<Record<string, PreparationResult>>({});
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [attempted, setAttempted] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visible = recipients.filter(recipient => results[recipient.id]?.status !== "success" && [recipient.full_name, recipient.document_number ?? "", recipient.email ?? ""].join(" ").toLocaleLowerCase("pt-BR").includes(term));
  const eligible = (id: string) => Boolean(choices[id]?.addressId && emailValid(choices[id].email) && results[id]?.status !== "success");
  const visibleEligible = visible.filter(recipient => eligible(recipient.id));
  const pending = selected.filter(id => results[id]?.status !== "success");
  const successes = Object.values(results).filter(result => result.status === "success").length;

  function selectVisible() {
    if (visibleEligible.every(recipient => selected.includes(recipient.id))) {
      setSelected(current => current.filter(id => !visibleEligible.some(recipient => recipient.id === id)));
    } else {
      const next = [...new Set([...selected, ...visibleEligible.map(recipient => recipient.id)])];
      setSelected(next.slice(0, 100));
      if (next.length > 100) setMessage("Seleção limitada a 100 destinatários por lote.");
    }
  }

  async function prepare() {
    if (runningRef.current || !pending.length) return;
    if (pending.length > 100 || pending.some(id => !eligible(id))) { setMessage("Confira o endereço e o e-mail dos destinatários selecionados."); return; }
    runningRef.current = true;
    setRunning(true);
    setMessage("");
    try {
      await runPreparationBatch(pending, {
        async prepare(id) {
          setAttempted(current => current.includes(id) ? current : [...current, id]);
          const choice = choices[id];
          const form = new FormData();
          Object.entries({ recipient_id: id, delivery_address_id: choice.addressId, customer_email: choice.email,
            idempotency_key: choice.key, quantity: String(ORDER_REFERENCE.quantity), unit_price: String(ORDER_REFERENCE.unitPrice), customer_purchase_order: "",
          }).forEach(([name, value]) => form.set(name, value));
          return prepareOrderAction({ status: "idle", message: "" }, form);
        },
        onResult(id, result) { setResults(current => ({ ...current, [id]: result })); },
      });
      onSaved();
    } catch { setMessage("O lote foi interrompido. Confira os resultados e tente novamente os pedidos pendentes nesta janela."); }
    finally { runningRef.current = false; setRunning(false); }
  }

  return <div className="recipient-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !running) onClose(); }}>
    <section className="recipient-modal order-batch-modal" role="dialog" aria-modal="true" aria-labelledby="order-batch-title" aria-busy={running}>
      <div className="recipient-modal-header">
        <div><span className="section-kicker">PREPARAÇÃO DE PEDIDOS</span><h2 id="order-batch-title">Selecionar destinatários</h2><p>Selecione até 100 destinatários. Será criado um pedido para cada selecionado.</p></div>
        <button type="button" className="icon-action" disabled={running} onClick={onClose} aria-label="Fechar"><X size={18} /></button>
      </div>
      <div className="recipient-form">
        <div className="order-product-card"><Package size={22} /><div><strong>{ORDER_REFERENCE.name} · {ORDER_REFERENCE.quantity} {ORDER_REFERENCE.unit} por pedido</strong><small>R$ 95,54 por unidade · Parâmetros do pedido 1107 · Pedido de compra vazio</small></div></div>
        <p className="order-batch-help">São exibidos apenas destinatários que ainda não foram usados em pedidos. Confira o endereço e o e-mail de cada destinatário. Endereços pendentes de validação são aceitos; endereços inválidos não podem ser usados.</p>
        <div className="order-batch-toolbar">
          <label className="recipient-search"><Search size={16} /><input aria-label="Buscar destinatários" placeholder="Buscar por nome, CPF ou e-mail" value={search} disabled={running} onChange={event => setSearch(event.target.value)} /></label>
          <button type="button" className="secondary-button" disabled={running || !visibleEligible.length} onClick={selectVisible}>{visibleEligible.length > 0 && visibleEligible.every(recipient => selected.includes(recipient.id)) ? "Desmarcar visíveis" : "Selecionar visíveis"}</button>
        </div>
        <div className="order-batch-list">
          {visible.map(recipient => {
            const choice = choices[recipient.id];
            const result = results[recipient.id];
            const locked = running || attempted.includes(recipient.id);
            const addresses = [...recipient.delivery_addresses].sort((a, b) => b.created_at.localeCompare(a.created_at));
            return <article className="order-batch-row" key={recipient.id}>
              <label className="order-batch-person"><input type="checkbox" aria-label={`Selecionar ${recipient.full_name}`} checked={selected.includes(recipient.id)} disabled={running || result?.status === "success" || (!selected.includes(recipient.id) && (!eligible(recipient.id) || selected.length >= 100))} onChange={event => setSelected(current => event.target.checked ? [...current, recipient.id] : current.filter(id => id !== recipient.id))} /><span><strong>{recipient.full_name}</strong><small>{recipient.document_number || "CPF não informado"}</small></span></label>
              <label>Endereço de entrega<select aria-label={`Endereço de ${recipient.full_name}`} value={choice.addressId} disabled={locked} onChange={event => setChoices(current => ({ ...current, [recipient.id]: { ...choice, addressId: event.target.value } }))}>
                {!choice.addressId && <option value="">Nenhum endereço disponível</option>}
                {addresses.map(address => <option key={address.id} value={address.id} disabled={address.validation_status === "invalid"}>{address.street}, {address.number}{address.complement ? " · " + address.complement : ""} · {address.district} · {address.city}/{address.state} · {address.postal_code}{address.validation_status === "invalid" ? " · Inválido" : address.validation_status !== "valid" ? " · Pendente de validação" : ""}</option>)}
              </select></label>
              <label>E-mail para NF-e<input type="email" aria-label={`E-mail de ${recipient.full_name}`} value={choice.email} maxLength={160} disabled={locked} onChange={event => setChoices(current => ({ ...current, [recipient.id]: { ...choice, email: event.target.value } }))} /></label>
              {!eligible(recipient.id) && result?.status !== "success" && <small className="order-batch-result">{!choice.addressId ? "Cadastre um endereço para preparar este pedido." : "Informe um e-mail válido para selecionar este destinatário."}</small>}
              {result && <small role="status" className={`order-batch-result omie-action-result-${result.status}`}>{result.message}</small>}
            </article>;
          })}
          {!visible.length && <p>{search.trim() ? "Nenhum destinatário encontrado." : "Nenhum destinatário disponível para preparar em massa."}</p>}
        </div>
        <div role="status" aria-live="polite" className="order-batch-summary">{selected.length} selecionado(s) · {successes} preparado(s) · {Object.values(results).filter(result => result.status === "error").length} com erro{running && " · Processando: mantenha esta janela aberta."}</div>
        {message && <div className="recipient-alert recipient-alert-error">{message}</div>}
        <div className="recipient-form-note">Os pedidos ficam preparados no Fulfillment. O envio ao Omie e o faturamento continuam em etapas separadas.</div>
        <div className="recipient-form-actions"><button type="button" className="recipient-cancel" disabled={running} onClick={onClose}>Fechar</button><button type="button" className="primary-button" disabled={running || !pending.length} onClick={prepare}>{running ? <><LoaderCircle size={16} className="auth-spinner" /> Preparando...</> : `Preparar ${pending.length} pedido(s)`}</button></div>
      </div>
    </section>
  </div>;
}
