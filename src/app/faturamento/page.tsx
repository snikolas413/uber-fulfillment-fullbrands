import { redirect } from "next/navigation";
import { ClipboardCheck, Clock3, FileText, ShieldCheck, Mail, Package } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type InvoiceRecord = { omie_invoice_number: string | null; access_key: string | null; status: string; issued_at: string | null };
type BillingRow = {
  id: string;
  status: string;
  omie_order_number: string | null;
  created_at: string;
  recipients: { full_name: string } | null;
  invoices: InvoiceRecord | InvoiceRecord[] | null;
};
type PreparedItem = {
  product_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};
type PreparedRow = {
  id: string;
  customer_purchase_order: string | null;
  customer_email: string | null;
  created_at: string;
  recipients: { full_name: string } | null;
  fulfillment_items: PreparedItem[];
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function statusLabel(status: string) {
  if (status === "order_created") return "Pedido criado no Omie";
  if (status === "billing_pending") return "Aguardando faturamento";
  if (status === "billed") return "Faturado";
  return status;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) redirect("/acesso-negado");

  const [preparedResult, billingResult] = await Promise.all([
    supabase
      .from("fulfillments")
      .select("id, customer_purchase_order, customer_email, created_at, recipients(full_name), fulfillment_items(product_code, description, quantity, unit_price, line_total)")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("fulfillments")
      .select("id, status, omie_order_number, created_at, recipients(full_name), invoices(omie_invoice_number, access_key, status, issued_at)")
      .in("status", ["order_created", "billing_pending", "billed"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const preparedRows = (preparedResult.data ?? []) as unknown as PreparedRow[];
  const rows = (billingResult.data ?? []) as unknown as BillingRow[];
  const pending = rows.filter((row) => row.status === "order_created" || row.status === "billing_pending").length;
  const billed = rows.filter((row) => row.status === "billed").length;
  const preparedValue = preparedRows.reduce(
    (sum, row) => sum + (row.fulfillment_items ?? []).reduce(
      (itemSum, item) => itemSum + Number(item.line_total ?? Number(item.quantity) * Number(item.unit_price)),
      0,
    ),
    0,
  );

  return (
    <div className="billing-page">
      <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> CONTROLE FISCAL</div><h1>Faturamento</h1><p className="page-lead">Confira as preparações e acompanhe os pedidos encaminhados ao Omie e suas informações de NF-e.</p></div><span className="history-access"><ShieldCheck size={14} /> Consulta</span></section>
      <section className="orders-notice"><div className="orders-notice-icon"><Clock3 size={17} /></div><div><strong>Integração fiscal em preparação</strong><p>As preparações locais aparecem abaixo para conferência. A criação do pedido no Omie e a emissão de NF-e continuam bloqueadas até a validação dos parâmetros comerciais/fiscais e das credenciais da aplicação.</p></div></section>
      <section className="orders-stats" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <article className="recipient-stat"><span className="recipient-stat-icon"><ClipboardCheck size={17} /></span><div><strong>{preparedRows.length + rows.length}</strong><small>Registros acompanhados</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Package size={17} /></span><div><strong>{preparedRows.length}</strong><small>Aguardando integração Omie</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Clock3 size={17} /></span><div><strong>{pending}</strong><small>Pendentes de faturamento</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><FileText size={17} /></span><div><strong>{billed}</strong><small>Marcados como faturados</small></div></article>
      </section>

      <section className="panel orders-panel" style={{ marginBottom: 17 }}>
        <div className="recipient-toolbar"><div><span className="section-kicker">PRÉ-CONFERÊNCIA</span><h2>Preparações aguardando integração</h2></div><span className="history-limit">{formatCurrency(preparedValue)} em preparação</span></div>
        {preparedResult.error ? <div className="recipient-alert recipient-alert-error">Não foi possível consultar as preparações pendentes.</div> : preparedRows.length ? (
          <div className="orders-table-wrap"><table className="orders-table">
            <thead><tr><th>DESTINATÁRIO</th><th>PURCHASE ORDER</th><th>E-MAIL PARA NF-E</th><th>ITEM</th><th>TOTAL</th><th>PREPARADO EM</th></tr></thead>
            <tbody>{preparedRows.map((row) => {
              const item = row.fulfillment_items?.[0];
              return <tr key={row.id}>
                <td><strong>{row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>Pedido local · ainda não enviado</small></td>
                <td>{row.customer_purchase_order || "Não informada"}</td>
                <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Mail size={12} />{row.customer_email || "Não informado"}</span></td>
                <td><strong>{item?.description ?? "Item não informado"}</strong><small>{item?.product_code ?? "—"} · {item?.quantity ?? 0} un.</small></td>
                <td><strong>{formatCurrency(Number(item?.line_total ?? Number(item?.quantity ?? 0) * Number(item?.unit_price ?? 0)))}</strong></td>
                <td>{formatDate(row.created_at)}</td>
              </tr>;
            })}</tbody>
          </table></div>
        ) : <div className="recipient-empty"><span className="recipient-empty-icon"><Package size={24} /></span><strong>Nenhuma preparação aguardando integração</strong><p>Quando um pedido local for preparado, ele aparecerá aqui para conferência antes de qualquer envio ao ERP.</p></div>}
        <div className="recipient-table-footer"><span>{preparedRows.length} preparação(ões) nesta fila</span><span>Esta tela é somente de conferência. Nenhuma chamada é feita ao Omie.</span></div>
      </section>

      <section className="panel orders-panel">
        <div className="recipient-toolbar"><div><span className="section-kicker">FILA DE FATURAMENTO</span><h2>Pedidos e notas fiscais</h2></div></div>
        {billingResult.error ? <div className="recipient-alert recipient-alert-error">Não foi possível consultar a fila fiscal.</div> : rows.length ? (
          <div className="orders-table-wrap"><table className="orders-table">
            <thead><tr><th>DESTINATÁRIO</th><th>PEDIDO OMIE</th><th>STATUS</th><th>NF-E</th><th>EMISSÃO</th></tr></thead>
            <tbody>{rows.map((row) => {
              const invoice = firstRelation(row.invoices);
              return <tr key={row.id}>
                <td><strong>{row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>{formatDate(row.created_at)}</small></td>
                <td>{row.omie_order_number ? `#${row.omie_order_number}` : "Aguardando número Omie"}</td>
                <td><span className={`order-status order-status-${row.status}`}>{statusLabel(row.status)}</span></td>
                <td>{invoice?.omie_invoice_number || "—"}</td>
                <td>{formatDate(invoice?.issued_at ?? null)}</td>
              </tr>;
            })}</tbody>
          </table></div>
        ) : <div className="recipient-empty"><span className="recipient-empty-icon"><FileText size={24} /></span><strong>Nenhum pedido aguardando faturamento</strong><p>Quando um pedido for enviado ao Omie e avançar para a fila fiscal, ele aparecerá aqui.</p></div>}
      </section>
    </div>
  );
}
