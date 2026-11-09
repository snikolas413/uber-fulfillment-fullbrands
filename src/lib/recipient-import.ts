export type ImportRow = {
  line: number;
  cpf: string;
  full_name: string;
  phone_number: string;
  email: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  codigo_postal: string;
};

export const IMPORT_COLUMNS = ["cpf", "full_name", "phone_number", "email", "endereco", "bairro", "cidade", "estado", "codigo_postal"] as const;
export const MAX_IMPORT_ROWS = 500;
export type ImportResult = {
  line: number;
  status: "created" | "skipped" | "error" | "unconfirmed" | "not_processed";
  message: string;
};

export type ImportReportEntry = { row: ImportRow; status: string; reason: string };

export function buildImportReport(rows: ImportRow[], validation: string[][], results: ImportResult[]): ImportReportEntry[] {
  const done = new Map(results.map(result => [result.line, result]));
  return rows.flatMap((row, index) => {
    const result = done.get(row.line);
    if (result?.status === "created") return [];
    if (result) {
      const labels = { skipped: "Ignorado", error: "Erro no cadastro", unconfirmed: "Resultado não confirmado", not_processed: "Não processado" };
      return [{ row, status: labels[result.status], reason: result.message }];
    }
    const errors = validation[index] ?? [];
    return errors.length ? [{ row, status: "Bloqueado na validação", reason: errors.join("; ") }] : [];
  });
}

function csvCell(value: string | number): string {
  let text = String(value);
  // CSV quoting does not stop spreadsheet formula execution.
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function importReportCsv(entries: ImportReportEntry[]): string {
  const headers = ["linha_arquivo", "situacao", "motivo", ...IMPORT_COLUMNS];
  const records = entries.map(({ row, status, reason }) => [
    row.line, status, reason, row.cpf, row.full_name, row.phone_number, row.email,
    [row.endereco, row.numero, row.complemento].filter(Boolean).join(" "),
    row.bairro, row.cidade, row.estado, row.codigo_postal,
  ]);
  return "\uFEFF" + [headers, ...records].map(record => record.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

export const digitsOnly = (value: string) => value.replace(/\D/g, "");
const normalizeHeader = (value: string) => value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s-]+/g, "_");
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

// Quoted separators, escaped quotes and multiline cells are kept intact.
export function parseDelimited(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = [";", ",", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; closed = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = ""; closed = false;
    } else {
      if (closed && char.trim()) throw new Error("CSV inválido: texto após o fechamento de aspas.");
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new Error("CSV inválido: uma célula ficou com aspas abertas.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function rowsFromCells(cells: unknown[][]): ImportRow[] {
  if (!cells.length) throw new Error("O arquivo está vazio.");
  const headers = cells[0].map(value => normalizeHeader(String(value ?? "")));
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error("Há colunas repetidas no cabeçalho.");
  const missing = IMPORT_COLUMNS.filter(column => !headers.includes(column));
  if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}.`);
  const rows: ImportRow[] = [];
  cells.slice(1).forEach((values, index) => {
    if (values.every(value => value == null || String(value).trim() === "")) return;
    if (values.length > headers.length && values.slice(headers.length).some(value => String(value ?? "").trim())) throw new Error(`Linha ${index + 2}: existem mais campos do que colunas. Confira o separador e as aspas.`);
    const get = (key: string) => String(values[headers.indexOf(key)] ?? "").trim();
    const address = get("endereco");
    // Prefer the explicit optional columns. Otherwise split at the last number,
    // keeping numbered street names such as Rua 25 de Março intact.
    const match = address.match(/^(.+?)[,\s]+(\d+[A-Za-z]?|s\/?n)(?:[,\s]+((?:casa|apto?|apartamento|bloco|fundos|sala|lote|quadra|complemento)\b.*))?$/i);
    const explicitNumber = get("numero");
    rows.push({ line: index + 2, cpf: digitsOnly(get("cpf")), full_name: get("full_name"),
      phone_number: digitsOnly(get("phone_number")), email: get("email").toLowerCase(),
      endereco: explicitNumber ? address : match?.[1].replace(/,$/, "") ?? address,
      numero: explicitNumber || match?.[2] || "", complemento: get("complemento") || (!explicitNumber ? match?.[3] ?? "" : ""),
      bairro: get("bairro"), cidade: get("cidade"), estado: get("estado").toUpperCase(), codigo_postal: digitsOnly(get("codigo_postal")) });
  });
  if (!rows.length) throw new Error("O arquivo não contém destinatários.");
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Envie no máximo ${MAX_IMPORT_ROWS} destinatários por arquivo.`);
  return rows;
}

export function validateImportRow(row: ImportRow): string[] {
  const errors: string[] = [];
  if (!/^\d{11}$/.test(row.cpf)) errors.push("CPF deve ter 11 dígitos; preserve zeros à esquerda no arquivo");
  if (row.full_name.length < 3 || row.full_name.length > 160) errors.push("Nome deve ter entre 3 e 160 caracteres");
  if (!/^\d{10,13}$/.test(row.phone_number)) errors.push("Telefone deve ter de 10 a 13 dígitos, com DDD");
  if (row.email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("E-mail inválido");
  if (!/^\d{8}$/.test(row.codigo_postal)) errors.push("CEP deve ter 8 dígitos; preserve zeros à esquerda no arquivo");
  for (const [key, label, max] of [["endereco", "Logradouro", 180], ["numero", "Número", 30], ["bairro", "Bairro", 100], ["cidade", "Cidade", 100]] as const) {
    if (!row[key] || row[key].length > max) errors.push(`${label} obrigatório, até ${max} caracteres`);
  }
  if (row.complemento.length > 100) errors.push("Complemento deve ter até 100 caracteres");
  if (!states.has(row.estado)) errors.push("UF inválida");
  return errors;
}
