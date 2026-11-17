import type { SupabaseClient } from "@supabase/supabase-js";

type ReportAddress = {
  id: string; postal_code: string; street: string; number: string; complement: string | null;
  district: string; city: string; state: string; validation_status: string; created_at: string;
};
export type ReportRecipient = {
  id: string; full_name: string; document_number: string | null; phone: string | null; email: string | null;
  created_at: string; updated_at: string; delivery_addresses: ReportAddress[] | null;
};
const PAGE_SIZE = 500;
const text = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const digits = (value: string) => value.replace(/\D/g, "");

export function recipientLatestAddress(recipient: ReportRecipient) {
  return [...(recipient.delivery_addresses ?? [])].sort((a,b) =>
    Date.parse(b.created_at)-Date.parse(a.created_at) || b.id.localeCompare(a.id))[0];
}

export function matchesRecipientSearch(recipient: ReportRecipient, search: string) {
  const term = text(search.trim());
  if (!term) return true;
  const address = recipientLatestAddress(recipient);
  const searchable = [recipient.full_name,recipient.document_number,recipient.email,recipient.phone,address?.city,address?.state,address?.postal_code].filter(Boolean).join(" ");
  const numeric = digits(term);
  return text(searchable).includes(term) || (numeric.length > 0 &&
    [recipient.document_number,recipient.phone,address?.postal_code].some(value => value && digits(value).includes(numeric)));
}

function cell(value: string | null | undefined) {
  let content = value ?? "";
  if (/^[\s\uFEFF]*[=+@-]/.test(content)) content = "'" + content;
  return '"' + content.replace(/"/g, '""') + '"';
}
const dateFormatter = new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"});
const date = (value: string) => Number.isFinite(Date.parse(value)) ? dateFormatter.format(new Date(value)) : "";
const statusLabels: Record<string,string> = {pending:"Pendente de validação",valid:"Validado",invalid:"Inválido",manual_review:"Revisão manual"};
export const RECIPIENT_REPORT_HEADERS = ["id_destinatario","cpf","full_name","phone_number","email","endereco","bairro","cidade","estado","codigo_postal","numero","complemento","status_endereco","cadastrado_em","atualizado_em"];

export function recipientReportCsv(rows: ReportRecipient[]) {
  const records = rows.map(row => {
    const address = recipientLatestAddress(row);
    return [row.id,row.document_number,row.full_name,row.phone,row.email,address?.street,address?.district,
      address?.city,address?.state,address?.postal_code,address?.number,address?.complement,
      address ? statusLabels[address.validation_status] ?? address.validation_status : "Sem endereço",
      date(row.created_at),date(row.updated_at)];
  });
  return "\uFEFF"+[RECIPIENT_REPORT_HEADERS,...records].map(record=>record.map(cell).join(";")).join("\r\n")+"\r\n";
}

export async function loadRecipientReport(client: SupabaseClient, search: string) {
  const rows: ReportRecipient[] = [];
  let cursor: string | null = null;
  const asOf = new Date().toISOString();
  // Keyset pagination reaches the whole authorized base, beyond PostgREST's row cap.
  for (;;) {
    let query = client.from("recipients")
      .select("id,full_name,document_number,phone,email,created_at,updated_at,delivery_addresses(id,postal_code,street,number,complement,district,city,state,validation_status,created_at)")
      .lte("created_at",asOf)
      .order("id",{ascending:true})
      .order("created_at",{ascending:false,referencedTable:"delivery_addresses"})
      .order("id",{ascending:false,referencedTable:"delivery_addresses"})
      .limit(1,{referencedTable:"delivery_addresses"}).limit(PAGE_SIZE);
    if (cursor) query = query.gt("id",cursor);
    const {data,error} = await query;
    if (error || !data) throw new Error("Não foi possível consultar todos os destinatários. Tente novamente.");
    const page = data as unknown as ReportRecipient[];
    rows.push(...page.filter(row=>matchesRecipientSearch(row,search)));
    // Continue even if the database's configured row cap is below PAGE_SIZE.
    if (!page.length) break;
    const next = page[page.length-1].id;
    if (next === cursor) throw new Error("Não foi possível concluir a paginação do relatório.");
    cursor = next;
  }
  return rows.sort((a,b)=>a.full_name.localeCompare(b.full_name,"pt-BR") || a.id.localeCompare(b.id));
}
