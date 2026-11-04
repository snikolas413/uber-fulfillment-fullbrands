import Link from "next/link";
import { ArrowRight, ArrowUpRight, Box, ClipboardCheck, FilePlus2, PackageCheck, PackageSearch, Plus, RefreshCw, Truck, Users } from "lucide-react";
const metrics = [
 { label:"Destinatários cadastrados", value:"0", note:"Aguardando primeiros cadastros", icon:Users },
 { label:"Pedidos criados", value:"0", note:"Sincronização Omie ainda não ativada", icon:FilePlus2 },
 { label:"Aguardando faturamento", value:"0", note:"Nenhum pedido pendente", icon:ClipboardCheck },
 { label:"Envios concluídos", value:"0", note:"Etiquetas ainda não geradas", icon:PackageCheck }
];
const steps = [
 { number:"01", title:"Cadastrar destinatários", description:"Inclua os dados pessoais e o endereço de entrega de cada motorista.", href:"/destinatarios", icon:Users },
 { number:"02", title:"Gerar pedidos no Omie", description:"Revise os dados e crie um pedido individual por destinatário.", href:"/pedidos", icon:FilePlus2 },
 { number:"03", title:"Faturar e preparar envios", description:"Fature em lote, gere etiquetas e documentos de expedição.", href:"/faturamento", icon:Truck }
];
export default function DashboardPage() {
 return <div className="dashboard-page">
  <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/> CENTRAL DE OPERAÇÕES</div><h1>Visão geral</h1><p className="page-lead">Acompanhe pedidos, faturamento e entregas da operação Uber em um só lugar.</p></div><Link href="/destinatarios" className="primary-button"><Plus size={17}/> Novo destinatário</Link></section>
  <section className="metric-grid" aria-label="Indicadores da operação">{metrics.map(({label,value,note,icon:Icon})=><article className="metric-card" key={label}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={18}/></span></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></article>)}</section>
  <section className="main-grid">
   <article className="panel process-panel"><div className="panel-heading"><div><span className="section-kicker">FLUXO OPERACIONAL</span><h2>Da origem à entrega</h2></div><span className="panel-icon"><RefreshCw size={17}/></span></div><p className="panel-description">Uma sequência simples, com rastreabilidade em cada etapa.</p>
    <div className="process-list">{steps.map(({number,title,description,href,icon:Icon},i)=><Link href={href} className="process-step" key={number}><span className="step-number">{number}</span><span className="step-icon"><Icon size={19}/></span><span className="step-copy"><strong>{title}</strong><small>{description}</small></span><ArrowUpRight className="step-arrow" size={18}/>{i<steps.length-1&&<span className="step-connector"/>}</Link>)}</div>
   </article>
   <article className="panel integration-panel"><div className="panel-heading"><div><span className="section-kicker">SAÚDE DAS CONEXÕES</span><h2>Integrações</h2></div><span className="panel-icon"><PackageSearch size={18}/></span></div>
    <div className="integration-row"><div className="integration-mark omie-mark">O</div><div className="integration-copy"><strong>Omie ERP</strong><small>Pedidos, NF-e e fretes</small></div><span className="status-tag status-pending">Pendente</span></div>
    <div className="integration-row"><div className="integration-mark database-mark">DB</div><div className="integration-copy"><strong>Banco de dados</strong><small>Destinatários e histórico</small></div><span className="status-tag status-pending">Pendente</span></div>
    <div className="integration-row"><div className="integration-mark shipping-mark"><Truck size={17}/></div><div className="integration-copy"><strong>Correios</strong><small>Mini Envios e etiquetas</small></div><span className="status-tag status-review">A validar</span></div>
    <div className="integration-footnote"><span className="footnote-dot"/> Nenhuma integração está executando operações em produção.</div>
   </article>
  </section>
  <section className="panel queue-panel"><div className="panel-heading queue-heading"><div><span className="section-kicker">ACOMPANHAMENTO</span><h2>Atividade recente</h2></div><Link href="/historico" className="text-link">Ver histórico <ArrowRight size={15}/></Link></div>
   <div className="empty-state"><div className="empty-icon"><Box size={23}/></div><strong>A operação começa por aqui</strong><p>Quando os primeiros destinatários forem cadastrados, pedidos e movimentações aparecerão nesta área.</p><Link href="/destinatarios" className="secondary-button">Cadastrar primeiro destinatário <ArrowRight size={15}/></Link></div>
  </section>
  <div className="dashboard-disclaimer">Os indicadores estão zerados porque esta é a instalação inicial. Nenhum dado de produção foi importado ou alterado.</div>
 </div>;
}
