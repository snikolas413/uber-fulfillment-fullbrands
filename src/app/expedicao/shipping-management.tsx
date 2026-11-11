"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MapPin, PackageCheck, Printer, Search, ShieldCheck, Truck } from "lucide-react";
import { OmieActionButton } from "@/components/omie-action-button";
import { LabelButton } from "./label-button";
import { generateShippingLabelAction, type LabelResult } from "./label-actions";
import { canPrepareShippingLabel, runShippingLabelBatch } from "@/lib/omie/shipping-label-batch";

type Shipment = { tracking_code: string | null; tracking_url: string | null; estimated_delivery_date: string | null; package_count: number | null; label_storage_path: string | null; label_generation_state: string; freight_amount: number | null };
type Invoice = { omie_invoice_number: string | null; access_key: string | null; status: string };
export type ShippingRow = { id: string; status: string; created_at: string; recipients: { full_name: string } | null; delivery_addresses: { city: string; state: string; postal_code: string } | null; shipments: Shipment | Shipment[] | null; invoices: Invoice | Invoice[] | null };
function firstRelation<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
const statusLabel = (status: string) => ({ billed: "Faturado · aguardando expedição", billing_pending: "Conferir confirmação da NF-e", shipping_pending: "Aguardando etiqueta", label_ready: "Etiqueta disponível", shipped: "Enviado" })[status] ?? status;
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));

export function ShippingManagement({ rows, canGenerate, loadError }: { rows: ShippingRow[]; canGenerate: boolean; loadError: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, LabelResult>>({});
  const [running, setRunning] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const runningRef = useRef(false); const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0); const [total, setTotal] = useState(0);
  const [printable, setPrintable] = useState<string[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visible = rows.filter(row => [row.recipients?.full_name, firstRelation(row.invoices)?.omie_invoice_number, firstRelation(row.shipments)?.tracking_code].join(" ").toLocaleLowerCase("pt-BR").includes(term));
  const ready = (row: ShippingRow) => results[row.id]?.status === "success" || Boolean(firstRelation(row.shipments)?.label_generation_state === "ready" && firstRelation(row.shipments)?.label_storage_path);
  const eligible = (row: ShippingRow) => ready(row) || (!results[row.id] && canPrepareShippingLabel(firstRelation(row.shipments)?.label_generation_state ?? "none"));
  const visibleEligible = visible.filter(eligible);
  const chosen = rows.filter(row => selected.includes(row.id) && eligible(row));
  const allChecked = visibleEligible.length > 0 && visibleEligible.every(row => selected.includes(row.id));
  function selectVisible() { setSelected(current => allChecked ? current.filter(id => !visibleEligible.some(row => row.id === id)) : [...new Set([...current, ...visibleEligible.map(row => row.id)])].slice(0, 100)); }

  async function assemble(ids: string[]) {
    setAssembling(true);
    try {
      const response = await fetch("/api/expedicao/etiquetas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("A resposta não contém o PDF do lote.");
      setPdfUrl(URL.createObjectURL(blob));
    } finally { setAssembling(false); }
  }

  async function run() {
    if (!canGenerate || runningRef.current || !chosen.length || chosen.length > 100) return;
    const ids = chosen.map(row => row.id);
    const toGenerate = chosen.filter(row => !ready(row)).length;
    if (toGenerate && !window.confirm(`Preparar etiquetas de ${ids.length} pedido(s)? ${toGenerate} pedido(s) precisam de geração ou conclusão no Omie, que pode envolver cobrança conforme o contrato. Etiquetas já salvas serão reutilizadas. O PDF final conterá somente os pedidos concluídos com sucesso.`)) return;
    runningRef.current = true; stopRef.current = false; setRunning(true); setStopping(false);
    setTotal(ids.length); setCompleted(0); setPrintable([]); setPdfUrl(null); setMessage("");
    try {
      const successIds = await runShippingLabelBatch(ids, {
        async generate(id) {
          const row = chosen.find(row => row.id === id)!;
          return ready(row) ? { status: "success", message: "Etiqueta salva reutilizada, sem nova geração no Omie.", url: `/api/expedicao/${id}/etiqueta` } : generateShippingLabelAction(id, true);
        },
        shouldStop: () => stopRef.current, onStart: setActiveId,
        onResult(id, result) { setResults(current => ({ ...current, [id]: result })); setCompleted(current => current + 1); setSelected(current => current.filter(value => value !== id)); },
      });
      setActiveId(null); setPrintable(successIds);
      setMessage(successIds.length ? `O PDF reúne ${successIds.length} de ${ids.length} pedido(s) selecionado(s). Pedidos com erro ou não processados não estão incluídos.` : "Nenhuma etiqueta confirmada para reunir. Confira os resultados individuais.");
      if (successIds.length) await assemble(successIds);
    } catch (error) { setMessage((error instanceof Error ? error.message : "Não foi possível montar o PDF do lote.") + " As etiquetas individuais concluídas continuam salvas."); }
    finally { runningRef.current = false; setRunning(false); setActiveId(null); router.refresh(); }
  }
  async function retryPdf() {
    if (runningRef.current || !printable.length) return;
    runningRef.current = true; setRunning(true);
    try { await assemble(printable); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível montar o PDF."); }
    finally { runningRef.current = false; setRunning(false); }
  }

  return <div className="shipping-page">
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> LOGÍSTICA E DISTRIBUIÇÃO</div><h1>Expedição</h1><p className="page-lead">Selecione os pedidos para gerar e imprimir etiquetas dos Correios com a chave da NF-e.</p></div><span className="history-access"><ShieldCheck size={14} /> {canGenerate ? "Operação" : "Consulta"}</span></section>
    <section className="orders-notice"><div className="orders-notice-icon"><Truck size={17} /></div><div><strong>Etiqueta Correios com chave da NF-e</strong><p>O lote reúne as etiquetas em um único PDF, mantendo uma página de 100 × 150 mm por volume. Imprima em tamanho real (100%). Reimpressões usam os arquivos já salvos.</p></div></section>
    <section className="orders-stats">
      <article className="recipient-stat"><PackageCheck size={17} /><div><strong>{rows.length}</strong><small>Pedidos na expedição</small></div></article>
      <article className="recipient-stat"><MapPin size={17} /><div><strong>{rows.filter(row => firstRelation(row.shipments)?.tracking_code).length}</strong><small>Com código de rastreio</small></div></article>
      <article className="recipient-stat"><Printer size={17} /><div><strong>{rows.filter(ready).length}</strong><small>Etiquetas disponíveis</small></div></article>
    </section>
    <section className="panel orders-panel">
      <div className="recipient-toolbar"><div><span className="section-kicker">FILA DE EXPEDIÇÃO</span><h2>Envios e rastreamento</h2></div><label className="recipient-search"><Search size={16} /><input aria-label="Buscar envios" placeholder="Buscar por destinatário, NF-e ou rastreio" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      {canGenerate && <div className="order-send-toolbar"><span>{chosen.length} selecionado(s) · Até 100 pedidos por lote</span><button type="button" className="primary-button" disabled={running || !chosen.length} onClick={run}>{running ? <LoaderCircle size={16} className="auth-spinner" /> : <Printer size={16} />}{assembling ? "Montando PDF..." : running ? "Preparando etiquetas..." : "Preparar etiquetas selecionadas"}</button>{running && !assembling && <button type="button" className="secondary-button" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>{stopping ? "Concluindo pedido atual..." : "Parar após o pedido atual"}</button>}</div>}
      {total > 0 && <div className="order-send-progress" role="status" aria-live="polite">{running ? "Processando" : "Lote encerrado"}: {completed} de {total} pedido(s). {running && "Mantenha esta página aberta."}{message && <p>{message}</p>}{pdfUrl && <a className="secondary-button" href={pdfUrl} target="_blank" rel="noreferrer">Abrir PDF do lote ({printable.length} pedidos)</a>}{!pdfUrl && printable.length > 0 && !running && <button type="button" className="secondary-button" onClick={retryPdf}>Tentar montar o PDF novamente</button>}</div>}
      {loadError && <div className="recipient-alert recipient-alert-error">Não foi possível consultar todos os envios.</div>}
      {visible.length ? <div className="orders-table-wrap"><table className="orders-table"><thead><tr>{canGenerate && <th><input type="checkbox" aria-label="Selecionar envios visíveis" checked={allChecked} disabled={running || !visibleEligible.length} onChange={selectVisible} /></th>}<th>DESTINATÁRIO</th><th>ENTREGA</th><th>NF-E</th><th>RASTREAMENTO</th><th>PREVISÃO / FRETE</th><th>STATUS</th><th>AÇÕES</th></tr></thead><tbody>{visible.map(row => {
        const shipment = firstRelation(row.shipments); const invoice = firstRelation(row.invoices); const result = results[row.id];
        return <tr key={row.id}>
          {canGenerate && <td><input type="checkbox" aria-label={`Selecionar envio de ${row.recipients?.full_name ?? row.id}`} checked={selected.includes(row.id)} disabled={running || !eligible(row) || (!selected.includes(row.id) && chosen.length >= 100)} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} /></td>}
          <td><strong>{row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>{date(row.created_at)}</small></td>
          <td>{row.delivery_addresses ? `${row.delivery_addresses.city}/${row.delivery_addresses.state} · ${row.delivery_addresses.postal_code}` : "Endereço indisponível"}</td>
          <td>{invoice?.omie_invoice_number ?? "—"}</td>
          <td><strong>{shipment?.tracking_code ?? "Aguardando código"}</strong>{shipment?.tracking_url && <small><a href={shipment.tracking_url} target="_blank" rel="noreferrer">Acompanhar entrega</a></small>}</td>
          <td><strong>{shipment?.estimated_delivery_date ? date(shipment.estimated_delivery_date + "T12:00:00") : "—"}</strong><small>{shipment?.freight_amount != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(shipment.freight_amount) : "Frete não informado"}</small><small>{shipment?.package_count ? `${shipment.package_count} volume(s)` : ""}</small></td>
          <td><span className={`order-status order-status-${row.status}`}>{statusLabel(row.status)}</span></td>
          <td>{activeId === row.id && <small role="status">Preparando etiqueta deste pedido...</small>}{result && <small role="status" className={`omie-action-result omie-action-result-${result.status}`}>{result.message}</small>}
            <LabelButton id={row.id} disabled={running} ready={ready(row)} canGenerate={canGenerate && canPrepareShippingLabel(shipment?.label_generation_state ?? "none")} />
            {["processing", "unknown"].includes(shipment?.label_generation_state ?? "") && <small>Geração em andamento ou sem confirmação. Confira no Omie antes de solicitar outra etiqueta.</small>}
            <OmieActionButton disabled={running} fulfillmentId={row.id} kind="sync-shipping" size="small" />
          </td>
        </tr>;
      })}</tbody></table></div> : <div className="recipient-empty"><Truck size={24} /><strong>Nenhum envio encontrado</strong><p>Os pedidos faturados aparecem aqui para preparar as etiquetas.</p></div>}
    </section>
  </div>;
}
