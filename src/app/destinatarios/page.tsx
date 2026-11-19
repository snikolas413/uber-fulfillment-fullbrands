import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RecipientManagement,type Recipient } from './recipient-management';
import { listParams } from '@/lib/operations-list';
import { loadRecipientDirectory } from '@/lib/recipient-directory';
export const dynamic='force-dynamic';
export default async function RecipientsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const db=await createSupabaseServerClient();const {data:auth,error:authError}=await db.auth.getUser();if(authError||!auth.user)redirect('/login');
  const {data:profile}=await db.from('user_profiles').select('role,is_active').eq('id',auth.user.id).maybeSingle();if(!profile?.is_active)redirect('/acesso-negado');
  const params=listParams(await searchParams,{all:'Todos'},'all');
  if(params.search&&!/[\p{L}]/u.test(params.search))params.search=params.search.replace(/\D/g,'');
  const result=await loadRecipientDirectory(db,params.search,params.page);
  return <RecipientManagement key={params.search+result.state.page} recipients={(result.data??[]) as unknown as Recipient[]} directory={result.state} canWrite={!result.error&&['admin','gestor','operador'].includes(profile.role)} loadError={result.error?'Não foi possível carregar todos os dados. Atualize a página antes de importar ou editar.':null}/>;
}
