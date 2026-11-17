"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, X } from "lucide-react";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, MAX_IMPORT_FILE_BYTES, IMPORT_BATCH_SIZE, IMPORT_PREVIEW_PAGE_SIZE, parseDelimited, rowsFromCells, validateImportRow, digitsOnly, buildImportReport, importReportCsv, type ImportRow, type ImportResult } from "@/lib/recipient-import";
import { type ImportInspection } from "@/lib/import-address";
import { importRecipientsAction, inspectImportAddressesAction } from "./import-actions";

const fields: [(typeof IMPORT_COLUMNS)[number] | "numero" | "complemento", string][] = [
  ["cpf", "CPF"], ["full_name", "Nome"], ["phone_number", "Telefone"], ["email", "E-mail"],
  ["endereco", "Logradouro"], ["numero", "Número"], ["complemento", "Complemento"], ["bairro", "Bairro"],
  ["cidade", "Cidade"], ["estado", "UF"], ["codigo_postal", "CEP"],
];

export function RecipientImport({ existingDocuments }: { existingDocuments: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [page, setPage] = useState(1);
  const [inspections, setInspections] = useState<Record<number, ImportInspection>>({});
  const [progress, setProgress] = useState("");
  const [stopping, setStopping] = useState(false);
  const [filter, setFilter] = useState<"all" | "ready" | "issues">("all");
  const stop = useRef(false);
  const running = useRef(false);
  const { validation, done, eligible, report } = useMemo(() => {
  const existing = new Set(existingDocuments.map(digitsOnly));
  const seen = new Set<string>();
  const validation = rows.map(row => {
    const errors = validateImportRow(row);
    if (seen.has(row.cpf)) errors.push("CPF repetido no arquivo");
    seen.add(row.cpf);
    if (existing.has(row.cpf)) errors.push("CPF já cadastrado; esta linha não será importada");
    if (!inspections[row.line]) errors.push("Aguardando conferência automática do endereço");
    else if (inspections[row.line].reviewRequired && !row.review_confirmed) errors.push((inspections[row.line].issues ?? inspections[row.line].warnings).join("; "));
    return errors;
  });
  const done = new Map(results.map(result => [result.line, result]));
  const eligible = rows.filter((row, index) => !validation[index].length && !["created", "skipped"].includes(done.get(row.line)?.status ?? ""));
  const report = buildImportReport(rows, validation, results);
  return {validation,done,eligible,report};
  }, [rows, inspections, results, existingDocuments]);
  const eligibleLines = new Set(eligible.map(row=>row.line));
  const preview = rows.map((row,index)=>({row,index})).filter(({row,index})=>filter === "all" || (filter === "ready" ? eligibleLines.has(row.line) : validation[index].length > 0 || ["error","unconfirmed","not_processed"].includes(done.get(row.line)?.status ?? "")));
  const pageCount = Math.max(1, Math.ceil(preview.length / IMPORT_PREVIEW_PAGE_SIZE));
  const currentPage = Math.min(page,pageCount);
  const offset = (currentPage-1)*IMPORT_PREVIEW_PAGE_SIZE;

  async function inspect(list: ImportRow[]) {
    stop.current = false; setStopping(false);
    for (let i=0;i<list.length;i+=IMPORT_BATCH_SIZE) {
      if (stop.current) break;
      setProgress(`Conferindo endereços: ${i} de ${list.length}`);
      const batch = list.slice(i,i+IMPORT_BATCH_SIZE);
      try {
        const checked = (await inspectImportAddressesAction(batch)).map(item=>({...item,row:{...item.row,review_confirmed:false}}));
        const checkedMap = new Map(checked.map(item => [item.row.line,item]));
        setInspections(previous => ({...previous,...Object.fromEntries(checked.map(item=>[item.row.line,item]))}));
        setRows(previous=>previous.map(row=>checkedMap.get(row.line)?.row ?? row));
      } catch {
        setMessage("A conferência de CEP foi interrompida. Os dados permanecem na prévia; tente conferir novamente ou revise manualmente as linhas pendentes.");
        break;
      }
      setProgress(`Endereços conferidos: ${Math.min(i+IMPORT_BATCH_SIZE,list.length)} de ${list.length}`);
    }
  }

  async function recheck(only?: ImportRow[]) {
    if (running.current) return;
    running.current=true; setBusy(true); setMessage("");
    try { await inspect(only ?? rows.filter(row=>!["created","skipped"].includes(done.get(row.line)?.status ?? "") &&
      (!inspections[row.line] || inspections[row.line].reviewRequired || inspections[row.line].warnings.some(warning=>warning.includes("indisponível"))))); }
    finally { running.current=false; setBusy(false); setStopping(false); }
  }

  async function load(file?: File) {
    if (!file || running.current) return;
    running.current = true; setBusy(true); setRows([]); setResults([]); setInspections({}); setPage(1); setFilter("all"); setProgress(""); setMessage(""); setFileName(file.name);
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("O arquivo deve ter no máximo 10 MB.");
      let cells: unknown[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        cells = await readSheet(file);
      } else if (/\.(csv|tsv)$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        let text = new TextDecoder("utf-8").decode(buffer);
        if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buffer);
        cells = parseDelimited(text);
      } else throw new Error("Selecione um arquivo .xlsx, .csv ou .tsv. Para .xls, salve como .xlsx.");
      const parsed = rowsFromCells(cells);
      setRows(parsed);
      await inspect(parsed);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível ler o arquivo."); }
    finally { running.current = false; setBusy(false); setStopping(false); }
  }

  async function save() {
    if (running.current || !eligible.length) return;
    running.current = true; stop.current=false; setStopping(false); setBusy(true); setMessage("");
    let offset = 0;
    try {
      for (; offset < eligible.length; offset += IMPORT_BATCH_SIZE) {
        if (stop.current) break;
        setProgress(`Importando: ${offset} de ${eligible.length}`);
        const batch = await importRecipientsAction(eligible.slice(offset, offset + IMPORT_BATCH_SIZE));
        setResults(previous => [...previous.filter(item => !batch.some(result => result.line === item.line)), ...batch]);
        setProgress(`Processados: ${Math.min(offset+IMPORT_BATCH_SIZE,eligible.length)} de ${eligible.length}`);
      }
      if (stop.current && offset < eligible.length) {
        const pending: ImportResult[] = eligible.slice(offset).map(row=>({line:row.line,status:"not_processed",message:"Linha não enviada: importação pausada pelo usuário."}));
        setResults(previous=>[...previous.filter(item=>!pending.some(result=>result.line===item.line)),...pending]);
      }
      setMessage(stop.current ? "Importação pausada. As etapas concluídas foram preservadas." : "Importação concluída. Confira os resultados por linha.");
    } catch (error) {
      const pending: ImportResult[] = eligible.slice(offset).map((row, index) => ({
        line: row.line,
        status: index < IMPORT_BATCH_SIZE ? "unconfirmed" : "not_processed",
        message: index < IMPORT_BATCH_SIZE ? "A etapa foi interrompida sem confirmação. Confira o cadastro antes de reenviar esta linha." : "Linha não enviada porque uma etapa anterior foi interrompida.",
      }));
      setResults(previous => [...previous.filter(item => !pending.some(result => result.line === item.line)), ...pending]);
      setMessage((error instanceof Error ? error.message : "Importação interrompida.") + " As etapas concluídas foram preservadas; baixe o relatório para conferir as pendências.");
    }
    finally { running.current = false; setBusy(false); setStopping(false); router.refresh(); }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + IMPORT_COLUMNS.join(";") + "\r\n"], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "modelo-destinatarios.csv"; link.click(); URL.revokeObjectURL(url);
  }

  function downloadReport() {
    const url = URL.createObjectURL(new Blob([importReportCsv(report)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-nao-importados-${fileName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]/gu, "-") || "destinatarios"}.csv`;
    link.click(); URL.revokeObjectURL(url);
  }

  return <>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)}><Upload size={16} /> Importar arquivo</button>
    {open && <div className="recipient-modal-backdrop">
      <section className="recipient-modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-busy={busy}>
        <div className="recipient-modal-header"><div><span className="section-kicker">CADASTRO EM MASSA</span><h2 id="import-title">Importar destinatários</h2><p>Selecione o arquivo, revise as linhas e confirme o cadastro.</p></div><button type="button" className="icon-action" disabled={busy} onClick={() => setOpen(false)} aria-label="Fechar importação"><X size={18} /></button></div>
        <div className="import-content">
          <p>Excel (.xlsx, primeira aba), CSV ou TSV. Até {MAX_IMPORT_ROWS} linhas e 10 MB. CPF com 10 dígitos e CEP com 7 recebem um zero à esquerda. O sistema organiza o endereço e consulta município e UF pelo CEP; confira as alterações na prévia.</p>
          <p>O modelo usa as nove colunas do seu arquivo: <strong>cpf, full_name, phone_number, email, endereco, bairro, cidade, estado, codigo_postal</strong>. Preencha o endereço completo em <strong>endereco</strong>, por exemplo: Rua Afonso 13 casa 2. Revise a separação do endereço na prévia abaixo.</p>
          <div className="import-tools"><button type="button" className="secondary-button" onClick={downloadTemplate}>Baixar modelo CSV</button><label className="secondary-button">Selecionar arquivo<input aria-label="Arquivo de destinatários" type="file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={event => { void load(event.target.files?.[0]); event.target.value = ""; }} /></label>{!!rows.length && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void recheck()}>Conferir endereços novamente</button>}{busy && <button type="button" className="secondary-button" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true);}}>{stopping ? "Concluindo etapa atual…" : "Parar após etapa atual"}</button>}</div>
          {progress && <p role="status" aria-live="polite">{progress}</p>}
          {fileName && <p>{fileName} · {rows.length} linha(s) · <strong>{eligible.length} pronta(s) para importar</strong> · {rows.filter(row=>inspections[row.line]?.reviewRequired && !row.review_confirmed).length} com divergência de endereço. Avisos de contato, bairro e consulta temporariamente indisponível não exigem confirmação manual.</p>}
          <p>CPFs existentes serão ignorados. Nenhum cadastro existente será atualizado. A validação de CPF confere o tamanho, sem verificar dígitos verificadores.</p>
          {message && <div className="recipient-alert" role="status">{message}</div>}
          {!busy && !!report.length && <div className="recipient-alert import-report" role="status"><div><strong>{report.length} linha(s) com pendências</strong><p>Importe as linhas prontas e trate apenas as pendências. CPFs existentes são ignorados, sem alterar o cadastro.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={downloadReport}><Download size={16} /> Baixar relatório de pendências (CSV)</button></div>}
          {!!rows.length && <div className="import-tools" role="group" aria-label="Filtrar prévia">{([['all','Todas'],['ready','Prontas para importar'],['issues','Somente pendências']] as const).map(([value,label])=><button key={value} type="button" className="secondary-button" aria-pressed={filter===value} onClick={()=>{setFilter(value);setPage(1);}}>{label}</button>)}</div>}
          {!!rows.length && !preview.length && <p role="status">Nenhuma linha neste filtro.</p>}
          {!!rows.length && <div className="import-table-wrap"><table className="recipient-table import-table"><thead><tr><th>LINHA</th>{fields.map(([key, label]) => <th key={key}>{label}</th>)}<th>VALIDAÇÃO / RESULTADO</th></tr></thead><tbody>
            {preview.slice(offset,offset+IMPORT_PREVIEW_PAGE_SIZE).map(({row,index}) => <tr key={row.line}><td>{row.line}</td>{fields.map(([key, label]) => <td key={key}><input aria-label={`${label}, linha ${row.line}`} value={row[key]} disabled={busy || ["created", "skipped"].includes(done.get(row.line)?.status ?? "")} onChange={event => {
              let value = event.target.value;
              if (["cpf", "phone_number", "codigo_postal"].includes(key)) value = digitsOnly(value);
              if (key === "estado") value = value.toUpperCase();
              const addressChanged = ["endereco","numero","complemento","bairro","cidade","estado","codigo_postal"].includes(key);
              setRows(previous => previous.map(item => item.line === row.line ? { ...item, [key]: value, review_confirmed:addressChanged ? false : item.review_confirmed, normalization_notes:addressChanged ? [] : item.normalization_notes } : item));
              if (addressChanged) setInspections(previous=>{const next={...previous};delete next[row.line];return next;});
              setResults(previous => previous.filter(item => item.line !== row.line));
            }} /></td>)}<td className="import-result">{done.get(row.line)?.message ?? (validation[index].join("; ") || "Pronto para importar")}
              {!!(row.normalization_notes?.length || inspections[row.line]?.warnings.length) && <details><summary>Ver ajustes e avisos</summary><small>{row.normalization_notes?.join(" ")}</small><small>{inspections[row.line]?.warnings.join(" ")}</small></details>}
              {!inspections[row.line] && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void recheck([row])}>Conferir endereço</button>}
              {inspections[row.line]?.reviewRequired && !["created","skipped"].includes(done.get(row.line)?.status ?? "") && <label><input type="checkbox" disabled={busy} checked={row.review_confirmed===true} onChange={event=>{const checked=event.target.checked;setRows(previous=>previous.map(item=>item.line===row.line?{...item,review_confirmed:checked}:item));setResults(previous=>previous.filter(item=>item.line!==row.line));}} /> Conferi a divergência real deste endereço</label>}</td></tr>)}
          </tbody></table></div>}
          {!!rows.length && <nav className="order-list-pagination" aria-label="Páginas da prévia"><button type="button" className="secondary-button" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>Anterior</button><span>Página {currentPage} de {pageCount} · {IMPORT_PREVIEW_PAGE_SIZE} linhas por página</span><button type="button" className="secondary-button" disabled={currentPage>=pageCount} onClick={()=>setPage(currentPage+1)}>Próxima</button></nav>}
          {!!results.length && <p role="status">{results.filter(result => result.status === "created").length} cadastrado(s), {report.length} linha(s) com pendências. Baixe o relatório para conferir os motivos.</p>}
          <div className="recipient-form-actions"><button type="button" className="recipient-cancel" disabled={busy} onClick={() => setOpen(false)}>Fechar</button><button type="button" className="primary-button" disabled={busy || !eligible.length} onClick={() => void save()}>{busy ? "Processando…" : `Confirmar importação de ${eligible.length} destinatário(s)`}</button></div>
        </div>
      </section>
    </div>}
  </>;
}
