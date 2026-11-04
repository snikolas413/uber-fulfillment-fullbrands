import Link from "next/link";
import { ArrowRight, ArrowUpRight, Box, ClipboardCheck, FilePlus2, PackageCheck, PackageSearch, Plus, RefreshCw, Truck, Users } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
 const supabase = await createSupabaseServerClient();
 const { data: authData } = await supabase.auth.getUser();
 let recipientsCount = 0;
 let ordersCount = 0;
 let billingCount = 0;
 let shippedCount = 0;
 let dataLoadFailed = false;

 if (authData.user) {
  const [recipients, orders, billing, shipped] = await Promise.all([
   supabase.from("recipients").select("id", { count: "exact", head: true }),
   supabase.from("fulfillments").select("id", { count: "exact", head: true }).not("omie_order_id", "is", null),
   supabase.from("fulfillments").select("id", { count: "exact", head: true }).eq("status", "billing_pending"),
   supabase.from("fulfillments").select("id", { count: "exact", head: true }).eq("status", "shipped"),
  ]);
  recipientsCount = recipients.count ?? 0;
  ordersCount = orders.count ?? 0;
  billingCount = billing.count ?? 0;
  shippedCount = shipped.count ?? 0;
  dataLoadFailed = Boolean(recipients.error || orders.error || billing.error || shipped.error);
 }

 const metrics = [
  { label:"Destinatários cadastrados", value:String(recipientsCount), note:"Base de motoristas", icon:Users },
  { label:"Pedidos criados", value:String(ordersCount), note:"Pedidos registrados no Omie", icon:FilePlus2 },
  { label:"Aguardando faturamento", value:String(billingCount), note:"Pedidos pendentes de NF-e", icon:ClipboardCheck },
  { label:"Envios concluídos", value:String(shippedCount), note:"Pedidos marcados como enviados", icon:PackageCheck }
 ];
 const steps = [
  { number:"01", title:"Cadastrar destinatários", description:"Inclua os dados pessoais e o endereço de entrega de cada motorista.", href:"/destinatarios", icon:Users },
  { number:"02", title:"Gerar pedidos no Omie", description:"Revise os dados e crie um pedido individual por destinatário.", href:"/pedidos", icon:FilePlus2 },
  { number:"03", title:"Faturar e preparar envios", description:"Fature em lote, gere etiquetas e documentos de expedição.", href:"/faturamento", icon:Truck }
 ];
 return <div className="dashboard-page">
  <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/> CENTRAL DE OPERAÇÕES</div><h1>Visão geral</h1><p className="page-lead">Acompanhe pedidos, faturamento e entregas da operação Uber em um só lugar.</p></div><Link href="/destinatarios" className="primary-button"><Plus size={17}/> Novo destinatário</Link></section>
  <section className="metric-grid" aria-label="Indicadores da operação">{metrics.map(({label,value,note,icon:Icon})=><article className="metric-card" key={label}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={18}/></span></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></article>)}</section>
  <section className="main-grid">
   <article className="panel process-panel"><div className="panel-heading"><div><span className="section-kicker">FLUXO OPERACIONAL</span><h2>Da origem à entrega</h2></div><span className="panel-icon"><RefreshCw size={17}/></span></div><p className="panel-description">Uma sequência simples, com rastreabilidade em cada etapa.</p>
    <div className="process-list">{steps.map(({number,title,description,href,icon:Icon})=><Link href={href} className="process-step" key={number}><span className="step-number">{number}</span><span className="step-icon"><Icon size={19}/></span><span className="step-copy"><strong>{title}</strong><small>{description}</small></span><ArrowUpRight className="step-arrow" size={18}/></Link>)}</div>
   </article>
   <article className="panel integration-panel"><div className="panel-heading"><div><span className="section-kicker">SAÚDE DAS CONEXÕES</span><h2>Integrações</h2></div><span className="panel-icon"><PackageSearch size={18}/></span></div>
    <div className="integration-row"><div className="integration-mark omie-mark">O</div><div className="integration-copy"><strong>Omie ERP</strong><small>Pedidos, NF-e e fretes</small></div><span className="status-tag status-pending">Credenciais pendentes</span></div>
    <div className="integration-row"><div className="integration-mark database-mark">DB</div><div className="integration-copy"><strong>Banco de dados</strong><small>Login e políticas de acesso validados</small></div><span className="status-tag status-review">Conectado</span></div>
    <div className="integration-row"><div className="integration-mark shipping-mark"><Truck size={17}/></div><div className="integration-copy"><strong>Correios</strong><small>Mini Envios e etiquetas</small></div><span className="status-tag status-review">A validar</span></div>
    <div className="integration-footnote"><span className="footnote-dot"/>{dataLoadFailed ? "Não foi possível atualizar todos os indicadores." : "Indicadores carregados diretamente do banco de dados."}</div>
   </article>
  </section>
  <section className="panel queue-panel"><div className="panel-heading queue-heading"><div><span className="section-kicker">ACOMPANHAMENTO</span><h2>Atividade recente</h2></div><Link href="/historico" className="text-link">Ver histórico <ArrowRight size={15}/></Link></div>
   <div className="empty-state"><div className="empty-icon"><Box size={23}/></div><strong>A operação começa por aqui</strong><p>As próximas etapas vão alimentar esta área com pedidos, notas fiscais e envios recentes.</p><Link href="/destinatarios" className="secondary-button">Acessar destinatários <ArrowRight size={15}/></Link></div>
  </section>
  <div className="dashboard-disclaimer">Os indicadores refletem os registros disponíveis no banco. Nenhuma operação fiscal ou logística é disparada pelo dashboard.</div>
 </div>;
}
