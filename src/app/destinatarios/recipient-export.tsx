"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { recipientReportPeriod } from "@/lib/recipient-report";

export function RecipientExport({search}:{search:string}) {
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [start,setStart] = useState("");
  const [end,setEnd] = useState("");
  async function download() {
    if (busy) return;
    try { recipientReportPeriod(start,end); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Período inválido."); return; }
    setBusy(true);setMessage("");
    try {
      const response = await fetch(`/api/destinatarios/relatorio?${new URLSearchParams({q:search.trim(),start,end})}`,{cache:"no-store"});
      if (!response.ok) throw new Error(await response.text());
      if (!response.headers.get("content-type")?.includes("text/csv")) throw new Error("Sua sessão expirou. Atualize a página e entre novamente.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href=url;link.download=response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "destinatarios.csv";
      document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
      setMessage(`${response.headers.get("X-Report-Row-Count") ?? ""} destinatário(s) exportado(s). Ao importar o CSV no Excel, defina CPF, telefone e CEP como texto para preservar os zeros.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível baixar o relatório."); }
    finally { setBusy(false); }
  }
  return <div className="recipient-export">
    <fieldset className="recipient-export-period" disabled={busy}><legend>Período de cadastro para exportação</legend>
      <label>Data inicial<input type="date" aria-label="Data inicial do relatório" value={start} max={end || undefined} onChange={event=>{setStart(event.target.value);setMessage("");}} /></label>
      <label>Data final<input type="date" aria-label="Data final do relatório" value={end} min={start || undefined} onChange={event=>{setEnd(event.target.value);setMessage("");}} /></label>
    </fieldset>
    <small>Inclui o dia final completo · Horário de São Paulo. Sem datas: toda a base.</small>
    {(start || end) && <button type="button" className="secondary-button" disabled={busy} onClick={()=>{setStart("");setEnd("");setMessage("");}}>Limpar período</button>}
    <button type="button" className="secondary-button" disabled={busy} onClick={()=>void download()}><Download size={16}/>{busy ? "Gerando relatório…" : search.trim() ? "Exportar busca (CSV)" : "Exportar destinatários (CSV)"}</button>{message && <small role="status">{message}</small>}</div>;
}
