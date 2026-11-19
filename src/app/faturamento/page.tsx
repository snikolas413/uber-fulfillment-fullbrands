import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { billingViews,listParams,loadOperationList,operationTotals } from '@/lib/operations-list';
import { QueueFilters,QueuePagination } from '@/components/queue-navigation';
import { BillingManagement,type BillingRow } from './billing-management';
export const dynamic='force-dynamic';
export default async function BillingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const db=await createSupabaseServerClient();
  const {data:auth,error:authError}=await db.auth.getUser();if(authError||!auth.user)redirect('/login');
  const {data:profile}=await db.from('user_profiles').select('role,is_active').eq('id',auth.user.id).maybeSingle();if(!profile?.is_active)redirect('/acesso-negado');
  const params=listParams(await searchParams,billingViews,'ready');
  const [result,totals]=await Promise.all([loadOperationList(db,'billing',params),operationTotals(db,'billing',billingViews)]);
  return <div className="billing-page"><section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/>CONTROLE FISCAL</div><h1>Faturamento</h1><p className="page-lead">Emita as notas dos pedidos liberados e acompanhe a autorização.</p></div></section>
    <QueueFilters path="/faturamento" views={billingViews} totals={totals} view={params.view} search={params.search}/>
    <details className="screen-help"><summary>Como funciona o faturamento</summary><p>Somente pedidos com separação confirmada podem ser faturados. A emissão exige sua confirmação e preserva as validações fiscais, de frete e contra duplicidade. A fila de confirmação acompanha a NF-e sem repetir a emissão. Mantenha a página aberta durante o lote.</p></details>
    {result.error?<div className="recipient-alert recipient-alert-error">Não foi possível consultar a fila fiscal.</div>:<BillingManagement key={params.view+':'+result.state.page+':'+params.search} rows={(result.data??[]) as unknown as BillingRow[]} canBill={['admin','gestor','operador'].includes(profile.role)} allowSubmission={['ready','attention'].includes(params.view)} count={result.state.count}/>}
    {!result.error&&<QueuePagination path="/faturamento" view={params.view} search={params.search} state={result.state}/>}
  </div>;
}
