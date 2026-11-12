"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, X } from "lucide-react";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, parseDelimited, rowsFromCells, validateImportRow, digitsOnly, buildImportReport, importReportCsv, type ImportRow, type ImportResult } from "@/lib/recipient-import";
import { importRecipientsAction } from "./import-actions";

const fields: [keyof Omit<ImportRow, "line">, string][] = [
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
  const running = useRef(false);
  const existing = new Set(existingDocuments.map(digitsOnly));
  const seen = new Set<string>();
  const validation = rows.map(row => {
    const errors = validateImportRow(row);
    if (seen.has(row.cpf)) errors.push("CPF repetido no arquivo");
    seen.add(row.cpf);
    if (existing.has(row.cpf)) errors.push("CPF já cadastrado; esta linha não será importada");
    return errors;
  });
  const done = new Map(results.map(result => [result.line, result]));
  const eligible = rows.filter((row, index) => !validation[index].length && !["created", "skipped"].includes(done.get(row.line)?.status ?? ""));
  const report = buildImportReport(rows, validation, results);

  async function load(file?: File) {
    if (!file || running.current) return;
    running.current = true; setBusy(true); setRows([]); setResults([]); setMessage(""); setFileName(file.name);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("O arquivo deve ter no máximo 5 MB.");
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
      setRows(rowsFromCells(cells));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível ler o arquivo."); }
    finally { running.current = false; setBusy(false); }
  }

  async function save() {
    if (running.current || !eligible.length) return;
    running.current = true; setBusy(true); setMessage("");
    let offset = 0;
    try {
      for (; offset < eligible.length; offset += 20) {
        const batch = await importRecipientsAction(eligible.slice(offset, offset + 20));
        setResults(previous => [...previous.filter(item => !batch.some(result => result.line === item.line)), ...batch]);
      }
      setMessage("Importação concluída. Confira os resultados por linha.");
    } catch (error) {
      const pending: ImportResult[] = eligible.slice(offset).map((row, index) => ({
        line: row.line,
        status: index < 20 ? "unconfirmed" : "not_processed",
        message: index < 20 ? "A etapa foi interrompida sem confirmação. Confira o cadastro antes de reenviar esta linha." : "Linha não enviada porque uma etapa anterior foi interrompida.",
      }));
      setResults(previous => [...previous.filter(item => !pending.some(result => result.line === item.line)), ...pending]);
      setMessage((error instanceof Error ? error.message : "Importação interrompida.") + " As etapas concluídas foram preservadas; baixe o relatório para conferir as pendências.");
    }
    finally { running.current = false; setBusy(false); router.refresh(); }
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
          <p>Excel (.xlsx, primeira aba), CSV ou TSV. Até {MAX_IMPORT_ROWS} linhas e 5 MB. Use as colunas do modelo e formate CPF, telefone e CEP como texto no Excel. CPFs com 10 dígitos recebem automaticamente um zero à esquerda na leitura do arquivo.</p>
          <p>O modelo usa as nove colunas do seu arquivo: <strong>cpf, full_name, phone_number, email, endereco, bairro, cidade, estado, codigo_postal</strong>. Preencha o endereço completo em <strong>endereco</strong>, por exemplo: Rua Afonso 13 casa 2. Revise a separação do endereço na prévia abaixo.</p>
          <div className="import-tools"><button type="button" className="secondary-button" onClick={downloadTemplate}>Baixar modelo CSV</button><label className="secondary-button">Selecionar arquivo<input aria-label="Arquivo de destinatários" type="file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={event => { void load(event.target.files?.[0]); event.target.value = ""; }} /></label></div>
          {fileName && <p>{fileName} · {rows.length} linha(s) · {eligible.length} apta(s) para importar</p>}
          <p>CPFs existentes serão ignorados. Nenhum cadastro existente será atualizado. A validação de CPF confere o tamanho, sem verificar dígitos verificadores.</p>
          {message && <div className="recipient-alert" role="status">{message}</div>}
          {!!report.length && <div className="recipient-alert import-report" role="status"><div><strong>{report.length} linha(s) com pendências</strong><p>O relatório inclui a linha do arquivo, os dados da prévia e o motivo do bloqueio ou da falha. Cadastros concluídos não entram no relatório.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={downloadReport}><Download size={16} /> Baixar relatório de pendências (CSV)</button></div>}
          {!!rows.length && <div className="import-table-wrap"><table className="recipient-table import-table"><thead><tr><th>LINHA</th>{fields.map(([key, label]) => <th key={key}>{label}</th>)}<th>VALIDAÇÃO / RESULTADO</th></tr></thead><tbody>
            {rows.map((row, index) => <tr key={row.line}><td>{row.line}</td>{fields.map(([key, label]) => <td key={key}><input aria-label={`${label}, linha ${row.line}`} value={row[key]} disabled={busy || ["created", "skipped"].includes(done.get(row.line)?.status ?? "")} onChange={event => {
              let value = event.target.value;
              if (["cpf", "phone_number", "codigo_postal"].includes(key)) value = digitsOnly(value);
              if (key === "estado") value = value.toUpperCase();
              setRows(previous => previous.map(item => item.line === row.line ? { ...item, [key]: value } : item));
              setResults(previous => previous.filter(item => item.line !== row.line));
            }} /></td>)}<td className="import-result">{done.get(row.line)?.message ?? (validation[index].join("; ") || "Pronto para importar")}</td></tr>)}
          </tbody></table></div>}
          {!!results.length && <p role="status">{results.filter(result => result.status === "created").length} cadastrado(s), {report.length} linha(s) com pendências. Baixe o relatório para conferir os motivos.</p>}
          <div className="recipient-form-actions"><button type="button" className="recipient-cancel" disabled={busy} onClick={() => setOpen(false)}>Fechar</button><button type="button" className="primary-button" disabled={busy || !eligible.length} onClick={() => void save()}>{busy ? "Processando…" : `Confirmar importação de ${eligible.length} destinatário(s)`}</button></div>
        </div>
      </section>
    </div>}
  </>;
}
