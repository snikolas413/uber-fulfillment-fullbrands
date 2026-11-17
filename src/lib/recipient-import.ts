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
  normalization_notes?: string[];
  review_confirmed?: boolean;
};

export const IMPORT_COLUMNS = ["cpf", "full_name", "phone_number", "email", "endereco", "bairro", "cidade", "estado", "codigo_postal"] as const;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const IMPORT_BATCH_SIZE = 50;
export const IMPORT_PREVIEW_PAGE_SIZE = 50;
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
export const normalizeText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normalizeHeader = (value: string) => {
  const key = normalizeText(value).replace(/ /g, "_");
  const aliases: Record<string,string> = { nome: "full_name", nome_completo: "full_name", telefone: "phone_number", celular: "phone_number", e_mail: "email", logradouro: "endereco", rua: "endereco", municipio: "cidade", uf: "estado", cep: "codigo_postal", numero_do_imovel: "numero" };
  return aliases[key] ?? key;
};
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const stateNames = ["Acre","Alagoas","Amapá","Amazonas","Bahia","Ceará","Distrito Federal","Espírito Santo","Goiás","Maranhão","Mato Grosso","Mato Grosso do Sul","Minas Gerais","Pará","Paraíba","Paraná","Pernambuco","Piauí","Rio de Janeiro","Rio Grande do Norte","Rio Grande do Sul","Rondônia","Roraima","Santa Catarina","São Paulo","Sergipe","Tocantins"];
const stateCodes = [...states];
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f\u200b\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
const identifierDigits = (value: string) => {
  if (/^\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(value) || /^\d+\.0+$/.test(value)) {
    const number = Number(value.replace(",", "."));
    if (Number.isSafeInteger(number) && number>=0) return String(number);
    return "";
  }
  return digitsOnly(value);
};

const addressPunctuation = (value: string) => value
  .replace(/[\u2010-\u2015\u2212\ufe63\uff0d]/g, "-")
  .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10));
const houseNumber = "(?:\\d+(?:\\s*[-/.]\\s*\\d+)*(?:\\s*[-/]?\\s*[A-Za-z])?|s\\s*[/.\\-]?\\s*n[º°.]?|sem\\s+n[úu]mero)";
const numberMarker = "(?:n[úu]mero|n\\.?\\s*[º°o]|n\\.|n(?=\\s*[:#]?\\s*\\d)|#|№)";
const numberPattern = new RegExp("^" + houseNumber + "$", "i");
const numberPrefix = new RegExp("^" + numberMarker + "\\s*[:#]?\\s*(?=" + houseNumber + "$)", "i");
const addressTail = "(?:[,;|•·\\s]+(.*))?$";
const addressNumberPatterns = [
  new RegExp("^(.+?)[,;|•·\\s-]+" + numberMarker + "\\s*[:.#]?\\s*(" + houseNumber + ")" + addressTail, "i"),
  new RegExp("^(.+?)[,;|•·:]\\s*(" + houseNumber + ")" + addressTail, "i"),
  new RegExp("^(.+?)\\s+-\\s*(" + houseNumber + ")" + addressTail, "i"),
  new RegExp("^(.+?)\\s+(" + houseNumber + ")(?:[,;|•·\\s]+((?:casa|ap(?:to?)?|apartamento|bl(?:oco)?|fundos|sala|lt|lote|qd|quadra|complemento)\\b.*))?$", "i"),
];
function normalizeHouseNumber(value: string) {
  let number = addressPunctuation(value).trim();
  number = number.replace(numberPrefix, "");
  if (/^(?:s\s*[/.\-]?\s*n[º°.]?|sem\s+n[úu]mero)$/i.test(number)) return "S/N";
  return numberPattern.test(number) ? number.replace(/\s+/g, "") : number;
}

export function normalizeImportRow(input: ImportRow): ImportRow {
  const row = { ...input };
  const notes = new Set((Array.isArray(input.normalization_notes) ? input.normalization_notes : []).filter(note => typeof note === "string"));
  for (const key of ["full_name","phone_number","email","endereco","numero","complemento","bairro","cidade","estado","codigo_postal","cpf"] as const) row[key] = clean(row[key]);
  row.cpf = identifierDigits(row.cpf);
  if (row.cpf.length === 10) { row.cpf = "0" + row.cpf; notes.add("CPF completado com zero à esquerda."); }
  row.codigo_postal = identifierDigits(row.codigo_postal);
  if (row.codigo_postal.length === 7) { row.codigo_postal = "0" + row.codigo_postal; notes.add("CEP completado com zero à esquerda; confira a consulta postal."); }
  row.phone_number = identifierDigits(row.phone_number);
  row.email = row.email.toLowerCase();
  // Remove only a repeated contiguous suffix, never guess or truncate a person's name.
  const words = row.full_name.split(" ");
  for (let size = Math.floor(words.length / 2); size >= 2; size--) {
    const tail = words.slice(-size).join(" ");
    const previous = words.slice(-size * 2, -size).join(" ");
    if (normalizeText(tail) === normalizeText(previous)) { row.full_name = words.slice(0, -size).join(" "); notes.add("Trecho duplicado do nome removido."); break; }
  }
  const ufIndex = stateNames.findIndex(name => normalizeText(name) === normalizeText(row.estado));
  if (ufIndex >= 0) row.estado = stateCodes[ufIndex];
  else row.estado = row.estado.toUpperCase().replace(/^BR[- /]/, "");
  const cityUf = row.cidade.match(/^(.*?)(?:\s*[/,-]\s*|\s+)([A-Za-z]{2})$/);
  if (cityUf && states.has(cityUf[2].toUpperCase()) && (!row.estado || row.estado === cityUf[2].toUpperCase())) {
    row.cidade = cityUf[1].trim(); row.estado = cityUf[2].toUpperCase(); notes.add("Município e UF separados.");
  }
  {
    const address = addressPunctuation(row.endereco);
    row.numero = normalizeHouseNumber(row.numero);
    const match = addressNumberPatterns.map(pattern => address.match(pattern)).find(Boolean);
    const street = match?.[1].replace(/[,;|•·:\s-]+$/, "");
    if (match && street && !/^(rua|r|avenida|av|estrada|travessa|tv|alameda|praca|rodovia|br)$/i.test(street) && !states.has(street.toUpperCase()) && !/\b(?:km|quil[oô]metro)$/i.test(street) && (!row.numero || row.numero.toUpperCase() === normalizeHouseNumber(match[2]).toUpperCase())) {
      row.endereco = street; row.numero = row.numero || normalizeHouseNumber(match[2]);
      if (match[3] && normalizeText(match[3]) !== normalizeText(row.complemento)) row.complemento = [row.complemento, match[3]].filter(Boolean).join(" · ");
      notes.add("Logradouro, número e complemento separados; confira a prévia.");
    }
  }
  if (/^s\s*\/?\s*n$|^sem\s+n[uú]mero$/i.test(row.numero)) row.numero = "S/N";
  row.normalization_notes = [...notes];
  return row;
}

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
  const missing = ["cpf", "full_name", "endereco", "codigo_postal"].filter(column => !headers.includes(column));
  if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}.`);
  const rows: ImportRow[] = [];
  cells.slice(1).forEach((values, index) => {
    if (values.every(value => value == null || String(value).trim() === "")) return;
    if (rows.length >= MAX_IMPORT_ROWS) throw new Error(`Envie no máximo ${MAX_IMPORT_ROWS} destinatários por arquivo.`);
    if (values.length > headers.length && values.slice(headers.length).some(value => String(value ?? "").trim())) throw new Error(`Linha ${index + 2}: existem mais campos do que colunas. Confira o separador e as aspas.`);
    const get = (key: string) => String(values[headers.indexOf(key)] ?? "").trim();
    rows.push(normalizeImportRow({ line: index + 2, cpf: get("cpf"), full_name: get("full_name"),
      phone_number: get("phone_number"), email: get("email"), endereco: get("endereco"),
      numero: get("numero"), complemento: get("complemento"), bairro: get("bairro"), cidade: get("cidade"),
      estado: get("estado"), codigo_postal: get("codigo_postal") }));
  });
  if (!rows.length) throw new Error("O arquivo não contém destinatários.");
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Envie no máximo ${MAX_IMPORT_ROWS} destinatários por arquivo.`);
  return rows;
}

export function validateImportRow(row: ImportRow): string[] {
  const errors: string[] = [];
  if (!/^\d{11}$/.test(row.cpf)) errors.push("CPF deve ter 11 dígitos; preserve zeros à esquerda no arquivo");
  if (row.full_name.length < 3 || row.full_name.length > 160) errors.push("Nome deve ter entre 3 e 160 caracteres");
  if (row.phone_number && !/^\d{10,13}$/.test(row.phone_number)) errors.push("Telefone deve ter de 10 a 13 dígitos, com DDD");
  if (row.email && (row.email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))) errors.push("E-mail inválido");
  if (!/^\d{8}$/.test(row.codigo_postal)) errors.push("CEP deve ter 8 dígitos; preserve zeros à esquerda no arquivo");
  for (const [key, label, max] of [["endereco", "Logradouro", 180], ["numero", "Número", 30], ["bairro", "Bairro", 100], ["cidade", "Cidade", 100]] as const) {
    if (!row[key] || row[key].length > max) errors.push(`${label} obrigatório, até ${max} caracteres`);
  }
  if (row.complemento.length > 100) errors.push("Complemento deve ter até 100 caracteres");
  if (!states.has(row.estado)) errors.push("UF inválida");
  return errors;
}
