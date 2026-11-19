import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { listParams,loadOperationList,operationTotals,shippingViews } from '@/lib/operations-list';
import { QueueFilters,QueuePagination } from '@/components/queue-navigation';
import { ShippingManagement,type ShippingRow } from './shipping-management';
export const dynamic='force-dynamic';
export default async function ShippingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const db=await createSupabaseServerClient();const {data:auth,error:authError}=await db.auth.getUser();if(authError||!auth.user)redirect('/login');
  const {data:profile}=await db.from('user_profiles').select('role,is_active').eq('id',auth.user.id).maybeSingle();if(!profile?.is_active)redirect('/acesso-negado');
  const params=listParams(await searchParams,shippingViews,'pending');
  const [result,totals]=await Promise.all([loadOperationList(db,'shipping',params),operationTotals(db,'shipping',shippingViews)]);
  return <div className="shipping-page"><section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/>LOGÍSTICA</div><h1>Expedição</h1><p className="page-lead">Prepare as etiquetas e imprima os pedidos prontos para postagem.</p></div></section>
    <QueueFilters path="/expedicao" views={shippingViews} totals={totals} view={params.view} search={params.search}/>
    <details className="screen-help"><summary>Como gerar e imprimir etiquetas</summary><p>O PDF utiliza uma página de 100 × 150 mm por volume. Imprima em tamanho real (100%). Etiquetas salvas são reutilizadas. Gerações sem confirmação exigem conferência no Omie. Mantenha esta tela aberta durante o lote.</p></details>
    <ShippingManagement key={params.view+':'+result.state.page+':'+params.search} rows={(result.data??[]) as unknown as ShippingRow[]} canGenerate={['admin','gestor','operador'].includes(profile.role)} loadError={Boolean(result.error)}/>
    {!result.error&&<QueuePagination path="/expedicao" view={params.view} search={params.search} state={result.state}/>}
  </div>;
}
