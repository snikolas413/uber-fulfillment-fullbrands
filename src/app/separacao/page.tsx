import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SeparationManagement, type SeparationRow } from './separation-management';
import { callOmie } from '@/lib/omie/client';
import { readSeparationStage } from '@/lib/omie/separation';

export const dynamic = 'force-dynamic';
export default async function SeparationPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const db = await createSupabaseServerClient();
  const {data:auth,error:authError}=await db.auth.getUser();
  if(authError||!auth.user) redirect('/login');
  const {data:profile}=await db.from('user_profiles').select('role,is_active').eq('id',auth.user.id).maybeSingle();
  if(!profile?.is_active) redirect('/acesso-negado');
  let stage: string | null = null, configurationError = '';
  try { stage = await readSeparationStage(callOmie); }
  catch (error) { configurationError = error instanceof Error ? error.message : 'Não foi possível consultar a etapa de separação no Omie.'; }
  const params=await searchParams;
  const requested=typeof params.page==='string'&&/^\d{1,7}$/.test(params.page)?Math.max(1,Number(params.page)):1;
  const query=(page:number,head=false)=>db.from('fulfillments')
    .select(head?'id':'id,status,omie_order_id,omie_order_number,omie_last_error,separation_state,delivery_recipient_name,recipients(full_name),fulfillment_items(description,quantity),invoices(status,access_key,omie_invoice_number)',{count:'exact',head})
    .in('status',['order_created','billing_pending']).neq('separation_state','confirmed')
    .order('created_at',{ascending:true}).order('id',{ascending:true}).range((page-1)*100,page*100-1);
  let result=await query(requested);
  const total=result.error?.code==='PGRST103'?(await query(1,true)).count:result.count;
  const pages=Math.max(1,Math.ceil((total??0)/100)),page=Math.min(requested,pages);
  if(page!==requested) result=await query(page);
  return <div className="orders-page">
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/>PREPARAÇÃO LOGÍSTICA</div><h1>Separação</h1><p className="page-lead">Envie os pedidos criados para a etapa de separação no Omie antes de faturar.</p></div><Link className="secondary-button" href="/faturamento">Ir para faturamento</Link></section>
    <section className="orders-notice"><div><strong>Pedidos → Separação → Faturamento → Expedição</strong><p>O envio confirmado no Omie libera o pedido na fila de faturamento. Esta etapa não emite NF-e nem gera etiqueta. Resultados incertos são conferidos sem repetir o envio.</p></div></section>
    {configurationError&&<div className="recipient-alert recipient-alert-error">{configurationError}</div>}
    {stage&&<p>Etapa de separação identificada no Omie: {stage}.</p>}
    {result.error?<div className="recipient-alert recipient-alert-error">Não foi possível consultar a fila de separação.</div>:<SeparationManagement key={page} rows={(result.data??[]) as unknown as SeparationRow[]} canSend={Boolean(stage)&&['admin','gestor','operador'].includes(profile.role)} count={total??0}/>}
    <div className="recipient-table-footer"><span>Página {page} de {pages}</span><nav aria-label="Páginas de separação" className="order-list-pagination">{page>1&&<Link className="secondary-button" href={'/separacao?page='+(page-1)}>Anterior</Link>}{page<pages&&<Link className="secondary-button" href={'/separacao?page='+(page+1)}>Próxima</Link>}</nav></div>
  </div>;
}
