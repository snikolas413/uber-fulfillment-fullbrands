import { redirect } from "next/navigation";
import { ClipboardCheck, Clock3, FileText, ShieldCheck } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type BillingRow = {
  id: string;
  status: string;
  omie_order_number: string | null;
  created_at: string;
  recipients: { full_name: string } | null;
  invoices: { omie_invoice_number: string | null; access_key: string | null; status: string; issued_at: string | null }[] | null;
};

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

  const { data, error } = await supabase
    .from("fulfillments")
    .select("id, status, omie_order_number, created_at, recipients(full_name), invoices(omie_invoice_number, access_key, status, issued_at)")
    .in("status", ["order_created", "billing_pending", "billed"])
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as unknown as BillingRow[];
  const pending = rows.filter((row) => row.status === "order_created" || row.status === "billing_pending").length;
  const billed = rows.filter((row) => row.status === "billed").length;

  return (
    <div className="billing-page">
      <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> CONTROLE FISCAL</div><h1>Faturamento</h1><p className="page-lead">Acompanhe os pedidos encaminhados ao Omie e suas informações de NF-e.</p></div><span className="history-access"><ShieldCheck size={14} /> Consulta</span></section>
      <section className="orders-notice"><div className="orders-notice-icon"><Clock3 size={17} /></div><div><strong>Emissão ainda não habilitada</strong><p>Esta tela acompanha os registros locais. A emissão de NF-e só será ativada depois de validar as credenciais, o fluxo fiscal e a integração Omie.</p></div></section>
      <section className="orders-stats">
        <article className="recipient-stat"><span className="recipient-stat-icon"><ClipboardCheck size={17} /></span><div><strong>{rows.length}</strong><small>Pedidos na fila fiscal</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Clock3 size={17} /></span><div><strong>{pending}</strong><small>Pendentes de faturamento</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><FileText size={17} /></span><div><strong>{billed}</strong><small>Marcados como faturados</small></div></article>
      </section>
      <section className="panel orders-panel">
        <div className="recipient-toolbar"><div><span className="section-kicker">FILA DE FATURAMENTO</span><h2>Pedidos e notas fiscais</h2></div></div>
        {error ? <div className="recipient-alert recipient-alert-error">Não foi possível consultar a fila fiscal.</div> : rows.length ? (
          <div className="orders-table-wrap"><table className="orders-table">
            <thead><tr><th>DESTINATÁRIO</th><th>PEDIDO OMIE</th><th>STATUS</th><th>NF-E</th><th>EMISSÃO</th></tr></thead>
            <tbody>{rows.map((row) => {
              const invoice = row.invoices?.[0];
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
