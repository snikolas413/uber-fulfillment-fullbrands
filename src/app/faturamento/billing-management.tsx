"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, FileText, LoaderCircle } from "lucide-react";
import { invoiceOrderAction, processNextInvoiceConfirmationAction } from "@/app/pedidos/omie-actions";
import { OmieActionButton } from "@/components/omie-action-button";
import { runBillingBatch } from "@/lib/omie/billing-batch";
import { isMiniEnviosName } from "@/lib/omie/freight-selection";
import { billingPageUrl, type BillingListState } from "@/lib/billing-list";

type InvoiceRecord = { omie_invoice_number: string | null; access_key: string | null; status: string; issued_at: string | null; danfe_url: string | null; xml_available: boolean; confirmation_state?: string; confirmation_last_error?: string | null };
type Shipment = { carrier_id: string | null; service_code: string | null; freight_amount: number | null };
export type BillingRow = {
  delivery_recipient_name?: string | null;
  id: string; status: string; omie_order_id: number | null; omie_order_number: string | null; omie_last_error: string | null;
  created_at: string; recipients: { full_name: string } | null;
  invoices: InvoiceRecord | InvoiceRecord[] | null; shipments: Shipment | Shipment[] | null;
};
type Result = Awaited<ReturnType<typeof invoiceOrderAction>> & { invoiceNumber?: string };
const first = <T,>(value: T | T[] | null) => Array.isArray(value) ? value[0] ?? null : value;
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value)) : "—";

function blockedReason(row: BillingRow, result?: Result) {
  const invoice = first(row.invoices);
  if (row.status === "billed" || invoice?.omie_invoice_number || invoice?.access_key) return "Já faturado";
  if (!["order_created", "billing_pending"].includes(row.status) || !row.omie_order_id || !row.omie_order_number) return "Pedido ainda não disponível no Omie";
  if ((invoice?.status.startsWith("billing_") && invoice.status !== "billing_rejected") ||
    (result?.billingOutcome && result.billingOutcome !== "rejected")) return "Solicitação registrada. Consulte o Omie antes de qualquer nova emissão.";
  if (row.omie_last_error?.startsWith("Frete: ")) return "Resolva a pendência de frete antes de faturar";
  const shipment = first(row.shipments);
  if (!shipment?.carrier_id || !shipment.service_code || !(shipment.service_code === "04227" || isMiniEnviosName(shipment.service_code)) ||
    shipment.freight_amount == null || Number(shipment.freight_amount) !== 0) return "Frete ainda não confirmado";
  return null;
}

export function BillingManagement({ rows, canBill, list }: { rows: BillingRow[]; canBill: boolean; list: BillingListState }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [waitingUntil, setWaitingUntil] = useState<number | null>(null);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const [confirmationNotice, setConfirmationNotice] = useState("");
  // This independent loop only reads due confirmation jobs. It never submits
  // invoices and resumes persisted jobs when the billing page is reopened.
  useEffect(() => {
    if (!canBill) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const result = await processNextInvoiceConfirmationAction();
        if (stopped) return;
        if (result.status === "error" && !result.hasJob) { setConfirmationNotice(result.message); return; }
        setConfirmationNotice("");
        if (result.hasJob && result.id) {
          const id = result.id;
          setResults(previous => ({ ...previous, [id]: result }));
          // Refresh only outside submission: changing a paginated queue during
          // a batch could unmount the component that owns the selected IDs.
          if (!runningRef.current && result.confirmationState !== "pending") router.refresh();
        }
      } catch {
        if (!stopped) setConfirmationNotice("Não foi possível consultar a fila de confirmação. As emissões permanecem protegidas contra repetição.");
      }
      if (!stopped) timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [canBill, router]);
  const eligible = rows.filter(row => !blockedReason(row, results[row.id]));
  const selectedRows = eligible.filter(row => selected.has(row.id));
  const allSelected = eligible.length > 0 && eligible.every(row => selected.has(row.id));
  const total = batchIds.length;
  const batchResults = batchIds.flatMap(id => results[id] ? [results[id]] : []);
  const completed = batchResults.length;
  const confirmed = batchResults.filter(result => result.billingOutcome === "confirmed").length;
  const awaiting = batchResults.filter(result => result.billingOutcome === "submitted").length;
  const pages = { prepared: list.prepared.page, pending: list.pending.page, billed: list.billed.page };

  async function run() {
    if (!canBill || runningRef.current || !selectedRows.length || selectedRows.length > 100) return;
    const orders = selectedRows.map(row => "#" + row.omie_order_number).join(", ");
    if (!window.confirm(`Confirmar faturamento de ${selectedRows.length} pedido(s) no Omie?\n\nPedidos: ${orders}\n\nEsta operação poderá emitir NF-e real para todos os pedidos selecionados e movimentar estoque. Os pedidos devem estar configurados sem contas a receber e sem boleto, com vencimento em 31/12/2026. Confira os dados comerciais e fiscais antes de continuar.`)) return;
    runningRef.current = true;
    stopRef.current = false;
    const ids = selectedRows.map(row => row.id);
    setRunning(true); setBatchIds(ids);
    setResults(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.includes(id))));
    const processed = new Set<string>();
    try {
      await runBillingBatch(ids, {
        invoice: id => invoiceOrderAction(id, true),
        onStart(id) { setWaitingUntil(null); setActiveId(id); }, shouldStop: () => stopRef.current,
        onWait(at) { setActiveId(null); setWaitingUntil(at); },
        onResult: (id, result) => { processed.add(id); setResults(previous => ({ ...previous, [id]: result })); },
      });
    } finally {
      setActiveId(null); setWaitingUntil(null); setRunning(false); runningRef.current = false;
      setSelected(previous => new Set([...previous].filter(id => !processed.has(id))));
      router.refresh();
    }
  }

  return <section className="panel orders-panel">
    <div className="recipient-toolbar billing-toolbar">
      <div><span className="section-kicker">FILA DE FATURAMENTO</span><h2>Pedidos e notas fiscais</h2></div>
      {canBill && <div className="billing-batch-actions">
        <span>{selectedRows.length} selecionado(s)</span>
        <button className="primary-button" disabled={running || !selectedRows.length} onClick={run}>
          {running ? <LoaderCircle size={15} className="auth-spinner" /> : <FileCheck2 size={15} />}
          {running ? "Faturando pedidos..." : "Faturar selecionados"}
        </button>
        {running && <button className="secondary-button" onClick={() => { stopRef.current = true; }}>Parar após o pedido atual</button>}
      </div>}
    </div>
    {total > 0 && <div className="billing-progress" role="status" aria-live="polite">
      <strong>{running ? "Enviando lote" : awaiting ? "Envio concluído; aguardando NF-e" : "Lote concluído"}: {completed} de {total} pedido(s)</strong>
      <span>{confirmed} NF-e(s) confirmada(s) · {awaiting} aguardando confirmação · {completed - confirmed - awaiting} com aviso ou erro</span>
      {waitingUntil && <small>Aguardando liberação da API até {new Date(waitingUntil).toLocaleTimeString("pt-BR")}. O lote seguirá para o próximo pedido.</small>}
      {running && <small>Mantenha esta página aberta. O lote segue após o aceite; a NF-e é conferida em uma fila separada.</small>}
    </div>}
    <div className="orders-notice"><p>As confirmações são consultadas enquanto esta página estiver aberta, sem repetir a emissão. Pendências ficam salvas e a conferência continua ao reabrir Faturamento.</p></div>
    {confirmationNotice && <div role="status" className="recipient-alert recipient-alert-error">{confirmationNotice} Atualize a página para retomar a conferência.</div>}
    {rows.length ? <div className="orders-table-wrap"><table className="orders-table billing-table">
      <thead><tr>
        {canBill && <th><input type="checkbox" aria-label="Selecionar todos os pedidos disponíveis" checked={allSelected} disabled={running || !eligible.length}
          onChange={event => setSelected(event.target.checked ? new Set(eligible.map(row => row.id)) : new Set())} /></th>}
        <th>DESTINATÁRIO</th><th>PEDIDO OMIE</th><th>STATUS</th><th>NF-E / DOCUMENTOS</th><th>EMISSÃO</th><th>RESULTADO / AÇÕES</th>
      </tr></thead>
      <tbody>{rows.map(row => {
        const invoice = first(row.invoices);
        const result = results[row.id];
        const blocked = blockedReason(row, result);
        return <tr key={row.id} className={activeId === row.id ? "billing-row-active" : undefined}>
          {canBill && <td><input type="checkbox" aria-label={`Selecionar pedido ${row.omie_order_number ?? "sem número"}`} title={blocked ?? "Selecionar para faturar"}
            checked={selected.has(row.id) && !blocked} disabled={running || Boolean(blocked)} onChange={event => setSelected(previous => {
              const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next;
            })} /></td>}
          <td><strong>{row.delivery_recipient_name ?? row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>{date(row.created_at)}</small></td>
          <td>{row.omie_order_number ? "#" + row.omie_order_number : "Aguardando número"}</td>
          <td><span className={`order-status order-status-${row.status}`}>{result?.billingOutcome === "confirmed" || (row.status === "billed" && invoice?.omie_invoice_number && invoice.access_key) ? "Faturado" : result?.billingOutcome === "submitted" || ["pending", "checking"].includes(invoice?.confirmation_state ?? "") ? "Aguardando confirmação da NF-e" : invoice?.confirmation_state === "error" ? "Conferir confirmação" : row.status === "billed" ? "Faturado" : invoice?.status.startsWith("billing_") && invoice.status !== "billing_rejected" ? "Conferir emissão" : "Aguardando faturamento"}</span></td>
          <td><strong>{result?.invoiceNumber || invoice?.omie_invoice_number || "—"}</strong><small>{invoice?.danfe_url ? <a href={invoice.danfe_url} target="_blank" rel="noreferrer">Abrir DANFE</a> : "DANFE não disponível"}</small><small>{invoice?.xml_available ? "XML disponível no Omie" : "XML ainda não recebido"}</small></td>
          <td>{date(invoice?.issued_at ?? null)}</td>
          <td>
            {activeId === row.id && <small role="status">Processando este pedido...</small>}
            {result && <small className={`omie-action-result omie-action-result-${result.status}`}>{result.message}</small>}
            {!result && row.omie_last_error && <small className="omie-action-result omie-action-result-warning">{row.omie_last_error}</small>}
            {!result && !row.omie_last_error && invoice?.confirmation_last_error && <small className="omie-action-result omie-action-result-warning">{invoice.confirmation_last_error}</small>}
            {!result && !row.omie_last_error && blocked && <small>{blocked}</small>}
            {!running && <OmieActionButton fulfillmentId={row.id} kind="sync-order" size="small" />}
            {canBill && !running && ["order_created", "billing_pending"].includes(row.status) &&
              (blocked === "Resolva a pendência de frete antes de faturar" || blocked === "Frete ainda não confirmado") && <>
                <small>Após ajustar Correios + Mini Envios grátis no Omie, confira o ajuste para liberar este pedido.</small>
                <OmieActionButton fulfillmentId={row.id} kind="confirm-manual-freight" size="small" onSuccess={() => {
                  setResults(previous => { const next = { ...previous }; delete next[row.id]; return next; });
                }} />
              </>}
          </td>
        </tr>;
      })}</tbody>
    </table></div> : <div className="recipient-empty"><span className="recipient-empty-icon"><FileText size={24} /></span><strong>Nenhum pedido aguardando faturamento</strong><p>Envie os pedidos preparados ao Omie para selecioná-los nesta fila.</p></div>}
    {(["pending", "billed"] as const).map(queue => <div className="recipient-table-footer" key={queue}>
      <span>{queue === "pending" ? "Pendentes" : "Faturados"}: {rows.filter(row => queue === "pending" ? row.status !== "billed" : row.status === "billed").length} de {list[queue].count} pedido(s)</span>
      <nav aria-label={queue === "pending" ? "Páginas de pedidos pendentes" : "Páginas de pedidos faturados"} className="order-list-pagination">
        <button type="button" className="secondary-button" disabled={running || list[queue].page <= 1} onClick={() => router.push(billingPageUrl(pages, queue, list[queue].page - 1))}>Anterior</button>
        <span>Página {list[queue].page} de {list[queue].pageCount}</span>
        <button type="button" className="secondary-button" disabled={running || list[queue].page >= list[queue].pageCount} onClick={() => router.push(billingPageUrl(pages, queue, list[queue].page + 1))}>Próxima</button>
      </nav>
    </div>)}
    <div className="recipient-table-footer"><span>Selecione até 100 pedidos da página atual por lote.</span><span>Emissões sem confirmação não são reenviadas automaticamente.</span></div>
  </section>;
}
