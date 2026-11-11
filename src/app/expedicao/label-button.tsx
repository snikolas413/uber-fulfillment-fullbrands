"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, LoaderCircle } from "lucide-react";
import { generateShippingLabelAction, type LabelResult } from "./label-actions";

export function LabelButton({ id, canGenerate, ready }: { id: string; canGenerate: boolean; ready: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LabelResult | null>(null);
  if (ready) return <a className="omie-action-button omie-action-button-small" href={`/api/expedicao/${id}/etiqueta`} target="_blank" rel="noreferrer"><Printer size={13} /> Abrir etiqueta 100 × 150</a>;
  if (!canGenerate) return null;
  function run() {
    if (!window.confirm("Gerar a etiqueta dos Correios deste pedido e acrescentar a chave da NF-e? A operação será solicitada ao Omie e pode envolver cobrança conforme o contrato de frete. Reimpressões usarão o mesmo PDF salvo.")) return;
    startTransition(async () => {
      try { setResult(await generateShippingLabelAction(id, true)); }
      catch { setResult({ status: "error", message: "Resposta não confirmada. Atualize a página e confira a situação da etiqueta antes de tentar novamente." }); }
      router.refresh();
    });
  }
  return <span className="omie-action-wrap">
    <button type="button" className="omie-action-button omie-action-button-small" disabled={pending} onClick={run}>{pending ? <LoaderCircle size={13} className="auth-spinner" /> : <Printer size={13} />}{pending ? "Preparando etiqueta..." : "Gerar etiqueta + NF-e"}</button>
    {result && <small className={`omie-action-result omie-action-result-${result.status}`} role="status">{result.message}</small>}
    {result?.url && <a href={result.url} target="_blank" rel="noreferrer">Abrir PDF para imprimir</a>}
  </span>;
}
