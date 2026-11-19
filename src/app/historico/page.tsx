import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { auditDescription } from '@/lib/audit-labels';
import { cleanNumber } from '@/lib/operations-list';
import { OperationNotice } from '@/components/operation-notice';
export const dynamic='force-dynamic';
type Entry={id:string;entity_id:string|null;entity_type:string;action:string;after_summary:Record<string,unknown>|null;created_at:string};
const views={all:'Todas as movimentações',errors:'Erros registrados',billing:'Faturamento',labels:'Etiquetas',separation:'Separação',recipients:'Cadastros'};
function day(value:unknown){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))?value:'';}
export default async function HistoryPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const db=await createSupabaseServerClient();const {data:auth,error:authError}=await db.auth.getUser();if(authError||!auth.user)redirect('/login');
  const {data:profile}=await db.from('user_profiles').select('role,is_active').eq('id',auth.user.id).maybeSingle();if(!profile?.is_active||!['admin','gestor'].includes(profile.role))redirect('/acesso-negado');
  const params=await searchParams,view=typeof params.view==='string'&&params.view in views?params.view:'all';
  const from=day(params.from),to=day(params.to),requested=typeof params.page==='string'&&/^\d{1,7}$/.test(params.page)?Math.max(1,Number(params.page)):1;
  const query=(page:number,head=false)=>{let q=db.from('audit_logs').select(head?'id':'id,entity_id,entity_type,action,after_summary,created_at',{count:'exact',head});
    if(view==='errors')q=q.ilike('action','%failed%');if(view==='billing')q=q.ilike('action','omie.invoice.%');if(view==='labels')q=q.ilike('action','shipping.%');if(view==='separation')q=q.ilike('action','omie.separation.%');if(view==='recipients')q=q.eq('entity_type','recipient');
    if(from)q=q.gte('created_at',from+'T00:00:00-03:00');if(to){const next=new Date(to+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);q=q.lt('created_at',next.toISOString().slice(0,10)+'T00:00:00-03:00');}
    return head?q:q.order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*100,page*100-1);};
  let result=await query(requested);const total=result.error?.code==='PGRST103'?(await query(1,true)).count:result.count;
  const pages=Math.max(1,Math.ceil((total??0)/100)),page=Math.min(requested,pages);if(page!==requested)result=await query(page);
  const entries=(result.data??[]) as unknown as Entry[];
  const ids=[...new Set(entries.filter(e=>e.entity_type==='fulfillment'&&e.entity_id).map(e=>e.entity_id!))];
  const refs=ids.length?await db.from('operation_orders').select('id,omie_order_number,invoices').in('id',ids):{data:[]};
  const lookup=new Map((refs.data??[]).map(row=>[row.id,row]));
  const url=(next:number)=>'/historico?'+new URLSearchParams({view,from,to,page:String(next)});
  return <div className="history-page"><section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/>RASTREABILIDADE</div><h1>Histórico</h1><p className="page-lead">Consulte o que aconteceu em cada etapa da operação.</p></div></section>
    <form className="queue-search history-filters" action="/historico"><label>Operação<select name="view" defaultValue={view}>{Object.entries(views).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>De<input aria-label="Data inicial" type="date" name="from" defaultValue={from}/></label><label>Até<input aria-label="Data final" type="date" name="to" defaultValue={to}/></label><button className="primary-button">Filtrar</button><Link className="secondary-button" href="/historico">Limpar</Link></form>
    <section className="panel"><div className="recipient-toolbar"><h2>Movimentações</h2><span>{result.error?'Consulta indisponível':(total??0)+' evento(s) no filtro'}</span></div>
    {result.error?<div className="recipient-alert recipient-alert-error">Não foi possível consultar o histórico.</div>:entries.length?<div className="history-list">{entries.map(entry=>{const ref=lookup.get(entry.entity_id),invoice=ref?.invoices as {omie_invoice_number?:string}|null;const message=entry.after_summary?.message;
      return <article className="history-event" key={entry.id}><div className="history-event-main"><strong>{auditDescription(entry.action)}</strong><div className="history-event-meta"><span>{ref?'Pedido #'+cleanNumber(ref.omie_order_number):entry.entity_type==='recipient'?'Destinatário':'Operação'}</span>{invoice?.omie_invoice_number&&<span>NF-e {cleanNumber(invoice.omie_invoice_number)}</span>}</div>{typeof message==='string'&&<OperationNotice message={message}/>}<details className="row-details"><summary>Detalhes do registro</summary><small>Evento: {entry.action} · Referência: {entry.entity_id??'Sistema'}</small></details></div><time>{new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(entry.created_at))}</time></article>;
    })}</div>:<div className="recipient-empty"><strong>Nenhuma movimentação neste filtro</strong></div>}
    <div className="recipient-table-footer"><span>Até 100 eventos por página</span><nav className="order-list-pagination" aria-label="Páginas do histórico">{page>1&&<Link className="secondary-button" href={url(page-1)}>Anterior</Link>}<span>Página {page} de {pages}</span>{page<pages&&<Link className="secondary-button" href={url(page+1)}>Próxima</Link>}</nav></div></section></div>;
}
