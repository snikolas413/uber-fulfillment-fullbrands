import { redirect } from "next/navigation";
import { ClipboardCheck, Clock3, FileText, ShieldCheck, Mail, Package } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BillingManagement, type BillingRow } from "./billing-management";
import { billingListParams, billingPageUrl, loadBillingQueue } from "@/lib/billing-list";

export const dynamic = "force-dynamic";

type PreparedItem = {
  product_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};
type PreparedRow = {
  delivery_recipient_name?: string | null;
  id: string;
  customer_purchase_order: string | null;
  customer_email: string | null;
  created_at: string;
  recipients: { full_name: string } | null;
  fulfillment_items: PreparedItem[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) redirect("/acesso-negado");
  const canBill = ["admin", "gestor", "operador"].includes(profile.role);
  const requestedPages = billingListParams(await searchParams);

  const [preparedResult, pendingResult, billedResult] = await Promise.all([
    loadBillingQueue(supabase, "prepared", requestedPages.prepared),
    loadBillingQueue(supabase, "pending", requestedPages.pending),
    loadBillingQueue(supabase, "billed", requestedPages.billed),
  ]);

  const preparedRows = (preparedResult.data ?? []) as unknown as PreparedRow[];
  const rows = [...(pendingResult.data ?? []), ...(billedResult.data ?? [])] as unknown as BillingRow[];
  const list = { prepared: preparedResult.state, pending: pendingResult.state, billed: billedResult.state };
  const pages = { prepared: list.prepared.page, pending: list.pending.page, billed: list.billed.page };
  const pending = list.pending.count;
  const billed = list.billed.count;
  const failed = Boolean(preparedResult.error || pendingResult.error || billedResult.error);
  const preparedValue = preparedRows.reduce(
    (sum, row) => sum + (row.fulfillment_items ?? []).reduce(
      (itemSum, item) => itemSum + Number(item.line_total ?? Number(item.quantity) * Number(item.unit_price)),
      0,
    ),
    0,
  );

  return (
    <div className="billing-page">
      <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> CONTROLE FISCAL</div><h1>Faturamento</h1><p className="page-lead">Selecione os pedidos preparados, confirme o faturamento e acompanhe o resultado de cada emissão no Omie.</p></div><span className="history-access"><ShieldCheck size={14} /> {canBill ? "Faturamento autorizado" : "Somente consulta"}</span></section>
      <section className="orders-notice"><div className="orders-notice-icon"><FileText size={17} /></div><div><strong>Faturamento dos pedidos selecionados</strong><p>A emissão de NF-e acontece somente após sua confirmação. Pedidos já faturados ou com emissão em andamento não recebem uma nova solicitação. O envio para separação deve estar confirmado antes do faturamento.</p></div></section>
      <section className="orders-stats billing-stats">
        <article className="recipient-stat"><span className="recipient-stat-icon"><ClipboardCheck size={17} /></span><div><strong>{failed ? "—" : list.prepared.count + pending + billed}</strong><small>Registros acompanhados</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Package size={17} /></span><div><strong>{preparedResult.error ? "—" : list.prepared.count}</strong><small>Aguardando integração Omie</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Clock3 size={17} /></span><div><strong>{pendingResult.error ? "—" : pending}</strong><small>Pendentes de faturamento</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><FileText size={17} /></span><div><strong>{billedResult.error ? "—" : billed}</strong><small>Marcados como faturados</small></div></article>
      </section>

      <section className="panel orders-panel" style={{ marginBottom: 17 }}>
        <div className="recipient-toolbar"><div><span className="section-kicker">PRÉ-CONFERÊNCIA</span><h2>Preparações aguardando integração</h2></div><span className="history-limit">{formatCurrency(preparedValue)} nesta página</span></div>
        {preparedResult.error ? <div className="recipient-alert recipient-alert-error">Não foi possível consultar as preparações pendentes.</div> : preparedRows.length ? (
          <div className="orders-table-wrap"><table className="orders-table">
            <thead><tr><th>DESTINATÁRIO</th><th>PURCHASE ORDER</th><th>E-MAIL PARA NF-E</th><th>ITEM</th><th>TOTAL</th><th>PREPARADO EM</th></tr></thead>
            <tbody>{preparedRows.map((row) => {
              const item = row.fulfillment_items?.[0];
              return <tr key={row.id}>
                <td><strong>{row.delivery_recipient_name ?? row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>Pedido local · ainda não enviado</small></td>
                <td>{row.customer_purchase_order || "Não informada"}</td>
                <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Mail size={12} />{row.customer_email || "Não informado"}</span></td>
                <td><strong>{item?.description ?? "Item não informado"}</strong><small>{item?.product_code ?? "—"} · {item?.quantity ?? 0} un.</small></td>
                <td><strong>{formatCurrency(Number(item?.line_total ?? Number(item?.quantity ?? 0) * Number(item?.unit_price ?? 0)))}</strong></td>
                <td>{formatDate(row.created_at)}</td>
              </tr>;
            })}</tbody>
          </table></div>
        ) : <div className="recipient-empty"><span className="recipient-empty-icon"><Package size={24} /></span><strong>Nenhuma preparação aguardando integração</strong><p>Quando um pedido local for preparado, ele aparecerá aqui para conferência antes de qualquer envio ao ERP.</p></div>}
        {!preparedResult.error && <div className="recipient-table-footer"><span>{preparedRows.length} de {list.prepared.count} preparação(ões)</span><nav aria-label="Páginas de preparações" className="order-list-pagination">
          {list.prepared.page > 1 && <a className="secondary-button" href={billingPageUrl(pages, "prepared", list.prepared.page - 1)}>Anterior</a>}
          <span>Página {list.prepared.page} de {list.prepared.pageCount}</span>
          {list.prepared.page < list.prepared.pageCount && <a className="secondary-button" href={billingPageUrl(pages, "prepared", list.prepared.page + 1)}>Próxima</a>}
        </nav></div>}
      </section>

      {pendingResult.error || billedResult.error ? <div className="recipient-alert recipient-alert-error">Não foi possível consultar a fila fiscal.</div> : <BillingManagement key={`${pages.pending}:${pages.billed}`} rows={rows} canBill={canBill} list={list} />}
    </div>
  );
}
