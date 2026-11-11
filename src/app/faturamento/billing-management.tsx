"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, FileText, LoaderCircle } from "lucide-react";
import { invoiceOrderAction } from "@/app/pedidos/omie-actions";
import { OmieActionButton } from "@/components/omie-action-button";
import { runBillingBatch } from "@/lib/omie/billing-batch";
import { isMiniEnviosName } from "@/lib/omie/freight-selection";

type InvoiceRecord = { omie_invoice_number: string | null; access_key: string | null; status: string; issued_at: string | null; danfe_url: string | null; xml_available: boolean };
type Shipment = { carrier_id: string | null; service_code: string | null; freight_amount: number | null };
export type BillingRow = {
  id: string; status: string; omie_order_id: number | null; omie_order_number: string | null; omie_last_error: string | null;
  created_at: string; recipients: { full_name: string } | null;
  invoices: InvoiceRecord | InvoiceRecord[] | null; shipments: Shipment | Shipment[] | null;
};
type Result = Awaited<ReturnType<typeof invoiceOrderAction>>;
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

export function BillingManagement({ rows, canBill }: { rows: BillingRow[]; canBill: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const eligible = rows.filter(row => !blockedReason(row, results[row.id]));
  const selectedRows = eligible.filter(row => selected.has(row.id));
  const allSelected = eligible.length > 0 && eligible.every(row => selected.has(row.id));
  const total = batchIds.length;
  const batchResults = batchIds.flatMap(id => results[id] ? [results[id]] : []);
  const completed = batchResults.length;
  const confirmed = batchResults.filter(result => result.billingOutcome === "confirmed").length;

  async function run() {
    if (!canBill || runningRef.current || !selectedRows.length || selectedRows.length > 100) return;
    const orders = selectedRows.map(row => "#" + row.omie_order_number).join(", ");
    if (!window.confirm(`Confirmar faturamento de ${selectedRows.length} pedido(s) no Omie?\n\nPedidos: ${orders}\n\nEsta operação poderá emitir NF-e real para todos os pedidos selecionados. Nos novos pedidos, o Omie também movimentará estoque e financeiro conforme o modelo 1107. Confira os dados comerciais e fiscais antes de continuar.`)) return;
    runningRef.current = true;
    stopRef.current = false;
    const ids = selectedRows.map(row => row.id);
    setRunning(true); setBatchIds(ids);
    setResults(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.includes(id))));
    const processed = new Set<string>();
    try {
      await runBillingBatch(ids, {
        invoice: id => invoiceOrderAction(id, true), onStart: setActiveId, shouldStop: () => stopRef.current,
        onResult: (id, result) => { processed.add(id); setResults(previous => ({ ...previous, [id]: result })); },
      });
    } finally {
      setActiveId(null); setRunning(false); runningRef.current = false;
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
      <strong>{running ? "Processando" : "Lote encerrado"}: {completed} de {total} pedido(s)</strong>
      <span>{confirmed} confirmado(s) no Omie · {completed - confirmed} com aviso ou pendência</span>
      {running && <small>Mantenha esta página aberta. O lote é processado um pedido por vez.</small>}
    </div>}
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
          <td><strong>{row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>{date(row.created_at)}</small></td>
          <td>{row.omie_order_number ? "#" + row.omie_order_number : "Aguardando número"}</td>
          <td><span className={`order-status order-status-${row.status}`}>{row.status === "billed" ? "Faturado" : invoice?.status.startsWith("billing_") && invoice.status !== "billing_rejected" ? "Conferir emissão" : "Aguardando faturamento"}</span></td>
          <td><strong>{invoice?.omie_invoice_number || "—"}</strong><small>{invoice?.danfe_url ? <a href={invoice.danfe_url} target="_blank" rel="noreferrer">Abrir DANFE</a> : "DANFE não disponível"}</small><small>{invoice?.xml_available ? "XML disponível no Omie" : "XML ainda não recebido"}</small></td>
          <td>{date(invoice?.issued_at ?? null)}</td>
          <td>
            {activeId === row.id && <small role="status">Processando este pedido...</small>}
            {result && <small className={`omie-action-result omie-action-result-${result.status}`}>{result.message}</small>}
            {!result && row.omie_last_error && <small className="omie-action-result omie-action-result-warning">{row.omie_last_error}</small>}
            {!result && !row.omie_last_error && blocked && <small>{blocked}</small>}
            {!running && <OmieActionButton fulfillmentId={row.id} kind="sync-order" size="small" />}
          </td>
        </tr>;
      })}</tbody>
    </table></div> : <div className="recipient-empty"><span className="recipient-empty-icon"><FileText size={24} /></span><strong>Nenhum pedido aguardando faturamento</strong><p>Envie os pedidos preparados ao Omie para selecioná-los nesta fila.</p></div>}
    <div className="recipient-table-footer"><span>Até 100 pendentes por lote e 100 faturados recentes. A fila carrega os próximos pendentes ao atualizar.</span><span>Uma falha não interrompe os demais pedidos. Emissões sem confirmação não são reenviadas automaticamente.</span></div>
  </section>;
}
