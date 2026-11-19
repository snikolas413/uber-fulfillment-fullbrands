import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCheck, ClipboardCheck, Clock3, FileText, Layers3, PackageCheck, ShieldCheck, Truck, Users, AlertCircle } from "lucide-react";
import styles from "./dashboard.module.css";

export type RecentDashboardOrder = {
  label_printable?: boolean; billing_queue?: string; separation_queue?: string; shipping_queue?: string;
  delivery_recipient_name?: string | null;
  id: string; status: string; created_at: string; omie_order_number: string | null;
  recipients: { full_name: string } | { full_name: string }[] | null;
  invoices: { omie_invoice_number: string | null } | { omie_invoice_number: string | null }[] | null;
};
export type OverviewCounts = Record<'recipients'|'orders'|'prepared'|'separation'|'billing'|'confirming'|'billed'|'labels'|'shipping'|'attention'|'shipped'|'cancelled',number|null>;
const first = <T,>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value;
const formatNumber = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("pt-BR").format(value);
const cleanNumber = (value: string) => value.replace(/^0+(?=\d)/, "");
const situations: Record<string, { label: string; tone: string }> = {
  ready: { label: "Preparado", tone: "neutral" }, order_pending: { label: "Envio em andamento", tone: "blue" },
  order_created: { label: "Aguardando separação", tone: "blue" }, billing_pending: { label: "Aguardando faturamento", tone: "amber" },
  billed: { label: "Faturado", tone: "green" }, shipping_pending: { label: "Aguardando etiqueta", tone: "amber" },
  label_ready: { label: "Etiqueta disponível", tone: "green" }, shipped: { label: "Enviado", tone: "green" },
  error: { label: "Revisar pedido", tone: "red" }, cancelled: { label: "Cancelado", tone: "neutral" },
};

export function DashboardOverview({ counts, recentOrders, recentFailed, dataLoadFailed, updatedAt }: {
  counts: OverviewCounts; recentOrders: RecentDashboardOrder[]; recentFailed: boolean; dataLoadFailed: boolean; updatedAt: string;
}) {
  const metrics = [
    { label: "Destinatários", value: counts.recipients, note: "Motoristas na sua base", icon: Users, href: "/destinatarios", key: "recipients" },
    { label: "Pedidos não cancelados", value: counts.orders, note: "Todas as etapas da operação", icon: Layers3, href: "/pedidos?view=active", key: "orders" },
    { label: "NF-e autorizadas", value: counts.billed, note: "Inclui pedidos que avançaram para expedição", icon: FileText, href: "/faturamento?view=billed", key: "billed" },
    { label: "Etiquetas prontas", value: counts.labels, note: "PDF salvo e vinculado à nota autorizada", icon: PackageCheck, href: "/expedicao?view=ready", key: "labels" },
  ];
  const steps = [
    { title: "Enviar ao Omie", description: formatNumber(counts.prepared)+" preparados", icon: Layers3, href: "/pedidos" },
    { title: "Separação", description: formatNumber(counts.separation)+" aguardando envio ou conferência", icon: PackageCheck, href: "/separacao" },
    { title: "Faturamento", description: formatNumber(counts.billing)+" prontos · "+formatNumber(counts.confirming)+" aguardando NF-e", icon: FileText, href: "/faturamento" },
    { title: "Expedição", description: formatNumber(counts.shipping)+" aguardando etiqueta · "+formatNumber(counts.labels)+" prontas", icon: Truck, href: "/expedicao" },
    { title: "Postagem", description: formatNumber(counts.shipped)+" marcados como enviados", icon: Truck, href: "/expedicao?view=shipped" },
  ];
  const hasBilling = counts.billing !== null && counts.billing > 0;
  const hasSeparation = (counts.separation??0)>0;
  const snapshot = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(updatedAt));

  return <div className={styles.dashboard}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}><span /> OPERAÇÃO UBER · FULL BRANDS</div><h1>Visão geral</h1><p>O panorama da sua operação, do cadastro à entrega.</p></div>
      <div className={styles.headerSide}><span className={styles.snapshot}><Clock3 size={13} /> Consultado em {snapshot}</span><Link href="/pedidos" className={styles.primaryLink}>Acessar pedidos <ArrowUpRight size={16} /></Link></div>
    </header>

    {dataLoadFailed && <div className={styles.warning} role="status"><AlertCircle size={16} /><span>Alguns dados não puderam ser atualizados. Recarregue a página para conferir os indicadores.</span></div>}

    <section className={styles.metrics} aria-label="Indicadores da operação">
      {metrics.map(({ label, value, note, icon: Icon, href, key }) => <Link href={href} className={`${styles.metric} ${key === "orders" ? styles.featuredMetric : ""}`} key={key}>
        <div className={styles.metricTop}><span className={styles.metricIcon}><Icon size={19} strokeWidth={1.7} /></span><ArrowUpRight size={15} className={styles.metricArrow} /></div>
        <span className={styles.metricLabel}>{label}</span><strong className={styles.metricValue}>{formatNumber(value)}</strong><small>{value === null ? "Consulta indisponível" : note}</small>
      </Link>)}
    </section>

    <section className={styles.focus} aria-label="Acompanhamento do faturamento">
      <span className={styles.focusIcon}>{hasBilling ? <ClipboardCheck size={21} /> : <CheckCheck size={21} />}</span>
      <div><strong>{hasSeparation?`${formatNumber(counts.separation)} pedidos aguardando separação`:hasBilling?`${formatNumber(counts.billing)} pedidos prontos para faturar`:'Acompanhe a próxima etapa da operação'}</strong><p>{formatNumber(counts.attention)} pedido(s) com aviso para conferência · {formatNumber(counts.cancelled)} cancelado(s). Os indicadores refletem a base local; não fazem nova consulta ao Omie.</p></div>
      <Link href={hasSeparation?'/separacao':'/faturamento'}>Abrir fila <ArrowRight size={16} /></Link>
    </section>

    <div className={styles.mainGrid}>
      <section className={styles.recent} aria-labelledby="recent-heading">
        <div className={styles.panelHeading}><div><span className={styles.kicker}>ACOMPANHAMENTO</span><h2 id="recent-heading">Pedidos recentes</h2><p>Os últimos registros da operação.</p></div><Link href="/historico" className={styles.textLink}>Ver histórico <ArrowUpRight size={15} /></Link></div>
        {recentFailed ? <div className={styles.empty}><AlertCircle size={27} /><strong>Consulta indisponível</strong><p>Não foi possível carregar os pedidos recentes. Recarregue a página para consultar novamente.</p></div> : recentOrders.length ? <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>DESTINATÁRIO</th><th>PEDIDO / NF-E</th><th>SITUAÇÃO</th><th>REGISTRO</th></tr></thead>
          <tbody>{recentOrders.map(order => {
            const recipient = order.delivery_recipient_name ?? first(order.recipients)?.full_name ?? "Destinatário indisponível";
            const invoice = first(order.invoices)?.omie_invoice_number;
            const status = order.status==='cancelled'?situations.cancelled:order.shipping_queue==='shipped'?situations.shipped:order.label_printable?situations.label_ready:order.separation_queue&&order.separation_queue!=='confirmed'?situations.order_created:order.billing_queue==='confirming'?{label:'Aguardando NF-e',tone:'amber'}:order.billing_queue==='attention'?{label:'Conferir pendência',tone:'red'}:order.label_printable===false&&order.status==='label_ready'?{label:'Conferir etiqueta',tone:'amber'}:situations[order.status] ?? { label: "Em acompanhamento", tone: "neutral" };
            const created = new Date(order.created_at);
            const validDate = !Number.isNaN(created.getTime());
            return <tr key={order.id}>
              <td><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{recipient.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("pt-BR")}</span><strong>{recipient}</strong></div></td>
              <td><strong>{order.omie_order_number ? `#${cleanNumber(order.omie_order_number)}` : "Pedido local"}</strong><small>{invoice ? `NF-e ${cleanNumber(invoice)}` : "Sem NF-e vinculada"}</small></td>
              <td><span className={`${styles.status} ${styles[status.tone]}`}><span />{status.label}</span></td>
              <td><span>{validDate ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }).format(created) : "—"}</span><small>{validDate ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(created) : ""}</small></td>
            </tr>;
          })}</tbody>
        </table></div> : <div className={styles.empty}><Layers3 size={30} strokeWidth={1.4} /><strong>Sua operação começa com o primeiro pedido</strong><p>Os pedidos preparados aparecerão aqui para você acompanhar cada etapa.</p><Link href="/pedidos" className={styles.textLink}>Acessar pedidos <ArrowRight size={15} /></Link></div>}
        <div className={styles.tableFooter}><span>Até 6 pedidos mais recentes</span><Link href="/pedidos">Ver todos os pedidos <ArrowRight size={14} /></Link></div>
      </section>

      <aside className={styles.workflow} aria-label="Acessos aos módulos da operação">
        <span className={styles.workflowKicker}>PRÓXIMOS PASSOS</span><h2>Filas da operação</h2><p className={styles.workflowLead}>Abra uma etapa para acompanhar os pedidos e suas pendências.</p>
        <nav aria-label="Etapas da operação">{steps.map(({ title, description, icon: Icon, href }, index) => <Link key={href} href={href} className={styles.workflowStep}>
          <span className={styles.stepIndex}>0{index + 1}</span><span className={styles.stepIcon}><Icon size={18} strokeWidth={1.7} /></span><span className={styles.stepCopy}><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={16} className={styles.workflowArrow} />
        </Link>)}</nav>
        <div className={styles.workflowFoot}><ShieldCheck size={16} /><span>Painel de acompanhamento<br /><small>Ações disponíveis em cada módulo.</small></span></div>
      </aside>
    </div>

    <footer className={styles.footer}><span><span className={styles.footerDot} /> Dados da base operacional do Fulfillment</span><span>Atualização ao abrir ou recarregar a página · Horário de Brasília</span></footer>
  </div>;
}
