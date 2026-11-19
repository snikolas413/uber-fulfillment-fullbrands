import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listParams,loadOperationList,operationTotals,separationViews } from '@/lib/operations-list';
import { QueueFilters,QueuePagination } from '@/components/queue-navigation';
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
  const params=listParams(await searchParams,separationViews,'awaiting');
  const [result,totals]=await Promise.all([loadOperationList(db,'separation',params),operationTotals(db,'separation',separationViews)]);
  return <div className="orders-page">
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/>PREPARAÇÃO LOGÍSTICA</div><h1>Separação</h1><p className="page-lead">Envie os pedidos criados para a etapa de separação no Omie antes de faturar.</p></div><Link className="secondary-button" href="/faturamento">Ir para faturamento</Link></section>
    <QueueFilters path="/separacao" views={separationViews} totals={totals} view={params.view} search={params.search} placeholder="Nome ou número do pedido"/>
    <details className="screen-help"><summary>Como enviar para separação</summary><p>Selecione os pedidos e confirme o envio. A confirmação da etapa no Omie libera o faturamento. Resultados incertos são conferidos sem repetir o envio.</p></details>
    {configurationError&&<div className="recipient-alert recipient-alert-error">{configurationError}</div>}

    {result.error?<div className="recipient-alert recipient-alert-error">Não foi possível consultar a fila de separação.</div>:<SeparationManagement key={params.view+result.state.page+params.search} rows={(result.data??[]) as unknown as SeparationRow[]} canSend={params.view!=='confirmed'&&Boolean(stage)&&['admin','gestor','operador'].includes(profile.role)} count={result.state.count}/>}
    {!result.error&&<QueuePagination path="/separacao" view={params.view} search={params.search} state={result.state}/>}
  </div>;
}
