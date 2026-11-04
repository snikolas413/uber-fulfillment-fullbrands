import { redirect } from "next/navigation";
import { Activity, Clock3, FileText, MapPin, Package, ShieldCheck } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuditEntry = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  after_summary: Record<string, unknown> | null;
  source: string;
  created_at: string;
};

function describeAction(entry: AuditEntry) {
  const details = entry.after_summary ?? {};
  if (entry.action === "recipient.created") return "Novo destinatário cadastrado";
  if (entry.action === "recipient.updated") {
    const addressChanged = details.address_version_created === true;
    const contactChanged = details.contact_changed === true;
    if (addressChanged && contactChanged) return "Dados de contato atualizados e nova versão de endereço criada";
    if (addressChanged) return "Nova versão de endereço criada";
    if (contactChanged) return "Dados de contato atualizados";
    return "Cadastro de destinatário revisado";
  }
  if (entry.action === "fulfillment.prepared") {
    const product = typeof details.product_code === "string" ? details.product_code : "Item";
    const quantity = typeof details.quantity === "number" ? details.quantity : 1;
    return `Preparação de pedido criada · ${product} · ${quantity} unidade(s)`;
  }
  return entry.action.replaceAll(".", " ");
}

function entityLabel(type: string) {
  if (type === "recipient") return "Destinatário";
  if (type === "fulfillment") return "Pedido";
  return type;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active) redirect("/acesso-negado");
  if (!["admin", "gestor"].includes(profile.role)) redirect("/acesso-negado");

  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, entity_type, entity_id, action, after_summary, source, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const events = (data ?? []) as unknown as AuditEntry[];

  return (
    <div className="history-page">
      <section className="welcome-row">
        <div><div className="eyebrow"><span className="eyebrow-line" /> CONTROLE E RASTREABILIDADE</div><h1>Histórico</h1><p className="page-lead">Registro cronológico das alterações realizadas na operação.</p></div>
        <span className="history-access"><ShieldCheck size={14} /> Acesso de gestão</span>
      </section>

      <section className="history-summary">
        <article className="recipient-stat"><span className="recipient-stat-icon"><Activity size={17} /></span><div><strong>{events.length}</strong><small>Eventos recentes</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><FileText size={17} /></span><div><strong>{events.filter((event) => event.entity_type === "recipient").length}</strong><small>Alterações cadastrais</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Package size={17} /></span><div><strong>{events.filter((event) => event.entity_type === "fulfillment").length}</strong><small>Preparações de pedidos</small></div></article>
      </section>

      <section className="panel history-panel">
        <div className="recipient-toolbar"><div><span className="section-kicker">AUDITORIA DO SISTEMA</span><h2>Últimas movimentações</h2></div><span className="history-limit">Últimos 100 eventos</span></div>
        {error ? (
          <div className="recipient-alert recipient-alert-error">Não foi possível consultar o histórico. Confira a conexão e as permissões de auditoria.</div>
        ) : events.length ? (
          <div className="history-list">
            {events.map((event) => (
              <article className="history-event" key={event.id}>
                <span className={`history-event-icon history-event-${event.entity_type}`}>{event.entity_type === "recipient" ? <MapPin size={16} /> : <Package size={16} />}</span>
                <div className="history-event-main">
                  <strong>{describeAction(event)}</strong>
                  <div className="history-event-meta"><span>{entityLabel(event.entity_type)}</span><span>·</span><span>{event.entity_id ? `ID …${event.entity_id.slice(-8)}` : "Sem identificador"}</span><span>·</span><span>{event.source === "application" ? "Aplicação" : event.source}</span></div>
                </div>
                <time><Clock3 size={12} />{formatDate(event.created_at)}</time>
              </article>
            ))}
          </div>
        ) : (
          <div className="recipient-empty"><span className="recipient-empty-icon"><Activity size={24} /></span><strong>Nenhuma movimentação registrada</strong><p>Os cadastros e preparações realizados pela aplicação aparecerão aqui, com data e identificação da entidade.</p></div>
        )}
      </section>
      <p className="history-footnote">A consulta é somente leitura. O sistema não permite alterar ou apagar registros de auditoria por esta tela.</p>
    </div>
  );
}
