"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadReviewOrderAction, saveReviewOrderAction, type ReviewData, type ReviewFields } from "./review-actions";

export function OrderReviewEditor({ fulfillmentId, disabled = false }: { fulfillmentId: string; disabled?: boolean }) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReviewData | null>(null);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function edit() {
    setOpen(true); setData(null); setSaved(false); setMessage("");
    startTransition(async () => {
      const result = await loadReviewOrderAction(fulfillmentId);
      setData(result.data ?? null); setMessage(result.message);
    });
  }
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || pending) return;
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(["name", "email", "postal_code", "street", "number", "complement", "district", "city", "state"].map(key => [key, String(form.get(key) ?? "").trim()])) as ReviewFields;
    startTransition(async () => {
      const result = await saveReviewOrderAction(fulfillmentId, data.version, fields);
      setMessage(result.message);
      if (result.status === "success") { setSaved(true); router.refresh(); }
    });
  }
  return <>
    <button type="button" className="omie-action-button" disabled={disabled || pending} onClick={edit}>Editar pedido</button>
    {open && <div className="recipient-modal-backdrop" onKeyDown={event => { if (event.key === "Escape" && !pending) setOpen(false); }}>
      <section className="recipient-modal order-review-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Corrigir pedido em Revisar</h2>
        <p>Corrija os dados de entrega deste pedido. Salvar mantém o pedido em Revisar; o envio ao Omie é feito separadamente.</p>
        {pending && !data && <p role="status">Carregando dados...</p>}
        {data && <form onSubmit={save}>
          {data.lastError && <div className="recipient-alert recipient-alert-error">Último retorno do Omie: {data.lastError}</div>}
          <fieldset disabled={pending || saved} className="order-review-fields">
            <div className="recipient-form-grid">
              <label>Nome de entrega (até 60)<input name="name" defaultValue={data.name} required maxLength={60} autoFocus /></label>
              <label>E-mail para NF-e<input name="email" type="email" defaultValue={data.email} required maxLength={160} /></label>
              <label>CEP (8 dígitos)<input name="postal_code" defaultValue={data.postal_code} required pattern="[0-9]{8}" maxLength={8} inputMode="numeric" /></label>
              <label>Logradouro (até 60)<input name="street" defaultValue={data.street} required maxLength={60} /></label>
              <label>Número (até 10)<input name="number" defaultValue={data.number} required maxLength={10} /></label>
              <label>Complemento (até 60)<input name="complement" defaultValue={data.complement} maxLength={60} /></label>
              <label>Bairro (até 60)<input name="district" defaultValue={data.district} required maxLength={60} /></label>
              <label>Cidade (sem UF)<input name="city" defaultValue={data.city} required maxLength={40} /></label>
              <label>UF<select name="state" defaultValue={data.state} required>{["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => <option key={uf}>{uf}</option>)}</select></label>
            </div>
            <label className="order-review-confirm"><input type="checkbox" required /> Conferi nome, CEP, cidade, UF e número do imóvel.</label>
          </fieldset>
          <div className="recipient-form-actions"><button type="button" className="secondary-button" disabled={pending} onClick={() => setOpen(false)}>{saved ? "Fechar e voltar ao pedido" : "Cancelar"}</button><button type="submit" className="primary-button" disabled={pending || saved}>{pending ? "Salvando..." : "Salvar correções"}</button></div>
        </form>}
        {message && <p role={saved ? "status" : "alert"}>{message}</p>}
        {!data && <button type="button" className="secondary-button" disabled={pending} onClick={() => setOpen(false)}>Fechar</button>}
      </section>
    </div>}
  </>;
}
