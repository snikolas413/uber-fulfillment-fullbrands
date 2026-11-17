import { normalizeImportRow, normalizeText, type ImportRow } from "./recipient-import";

export type PostalAddress = { cep: string; logradouro: string; bairro: string; localidade: string; uf: string };
export type PostalLookup = (cep: string) => Promise<PostalAddress | null>;
export type ImportInspection = { row: ImportRow; warnings: string[]; reviewRequired: boolean; issues?: string[] };

function nearby(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length,b.length) < 5) return false;
  let previous = Array.from({length:b.length+1}, (_,i)=>i);
  for (let i=0;i<a.length;i++) {
    const next = [i+1];
    for (let j=0;j<b.length;j++) next.push(Math.min(next[j]+1,previous[j+1]+1,previous[j]+Number(a[i]!==b[j])));
    previous=next;
  }
  return previous[b.length] <= 2;
}
const streetKey = (s: string) => normalizeText(s).replace(/^(?:rua|r|avenida|av|estrada|est|travessa|tv|alameda|al|praca|pc|rodovia|rod) /, "")
  .replace(/\b(?:doutor|doutora|dra)\b/g, "dr").replace(/\bprofessor(?:a)?\b/g, "prof").replace(/\bpresidente\b/g, "pres").replace(/ numero$/, "");

export async function inspectImportAddress(input: ImportRow, lookup: PostalLookup): Promise<ImportInspection> {
  const row = normalizeImportRow(input);
  const warnings: string[] = [];
  const issues: string[] = [];
  let reviewRequired = false;
  const review = (message: string) => { warnings.push(message); issues.push(message); reviewRequired = true; };
  if (!row.email) warnings.push("Sem e-mail: preencha antes de preparar o pedido no Omie.");
  if (!row.phone_number) warnings.push("Telefone não informado.");
  if (row.full_name.length > 60) warnings.push("Ajuste o nome para até 60 caracteres antes de preparar o pedido no Omie. Este aviso não impede o cadastro.");
  if (row.endereco.length > 60 || row.complemento.length > 60 || row.numero.length > 10) warnings.push("Ajuste os limites do endereço antes de preparar o pedido no Omie (rua/complemento 60; número 10). Este aviso não impede o cadastro.");
  if (!/^\d{8}$/.test(row.codigo_postal)) return {row,warnings,reviewRequired,issues};
  let postal: PostalAddress | null;
  try { postal = await lookup(row.codigo_postal); }
  catch { warnings.push("Consulta de CEP temporariamente indisponível. O cadastro pode continuar com os dados do arquivo; o CEP permanece sem conferência."); return {row,warnings,reviewRequired,issues}; }
  if (!postal) { review("CEP não encontrado na base postal. Confirme os dados ou corrija o CEP."); return {row,warnings,reviewRequired,issues}; }
  const city = normalizeText(row.cidade), official = normalizeText(postal.localidade);
  const compatibleCity = !city || city === official || (city === postal.uf.toLowerCase() && row.estado === postal.uf) ||
    nearby(city,official) || city.endsWith(" " + official) ||
    (city.startsWith(official + " ") && /^\d+$/.test(city.slice(official.length).trim()));
  const matchingStreet = !!postal.logradouro && nearby(streetKey(row.endereco),streetKey(postal.logradouro));
  if (compatibleCity || (matchingStreet && (!row.estado || row.estado === postal.uf))) {
    if (row.cidade !== postal.localidade || row.estado !== postal.uf) {
      row.normalization_notes = [...new Set([...(row.normalization_notes ?? []), `Município/UF conferidos pelo CEP: ${postal.localidade}/${postal.uf}.`])];
      row.cidade = postal.localidade; row.estado = postal.uf;
    }
  } else review(`Município divergente do CEP: arquivo ${row.cidade}/${row.estado}; consulta ${postal.localidade}/${postal.uf}. Corrija a cidade ou o CEP.`);
  if (!row.bairro && postal.bairro) { row.bairro = postal.bairro; row.normalization_notes?.push("Bairro preenchido pela consulta de CEP."); }
  else if (postal.bairro && normalizeText(row.bairro) !== normalizeText(postal.bairro) && !normalizeText(postal.bairro).startsWith(normalizeText(row.bairro)+" ")) warnings.push(`Bairro informado preservado: ${row.bairro}. Referência do CEP: ${postal.bairro}.`);
  // The uploaded CEP is the user's source of truth for the street name.
  // Number/complement were extracted above and must never come from the postal service.
  if (postal.logradouro.trim() && row.endereco !== postal.logradouro.trim()) {
    row.normalization_notes?.push(`Logradouro ajustado pelo CEP: ${row.endereco || "não informado"} → ${postal.logradouro.trim()}. Número e complemento preservados.`);
    row.endereco = postal.logradouro.trim();
  }
  return {row,warnings,reviewRequired,issues};
}
