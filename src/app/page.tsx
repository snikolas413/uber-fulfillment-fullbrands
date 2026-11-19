import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DashboardOverview,type RecentDashboardOrder,type OverviewCounts } from './dashboard-overview';
export const dynamic='force-dynamic';
export default async function DashboardPage(){
  const db=await createSupabaseServerClient();
  const {data:auth,error:authError}=await db.auth.getUser();
  if(authError||!auth.user)redirect('/login');
  const {data:profile}=await db.from('user_profiles').select('is_active').eq('id',auth.user.id).maybeSingle();
  if(!profile?.is_active)redirect('/acesso-negado');
  const [overview,recent]=await Promise.all([
    db.rpc('operation_overview'),
    db.from('operation_orders').select('id,status,created_at,omie_order_number,delivery_recipient_name,recipients,invoices,label_printable,billing_queue,separation_queue,shipping_queue').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(6),
  ]);
  const keys=['recipients','orders','prepared','separation','billing','confirming','billed','labels','shipping','attention','shipped','cancelled'] as const;
  const counts=Object.fromEntries(keys.map(key=>[key,overview.error?null:Number(overview.data?.[key]??0)])) as OverviewCounts;
  return <DashboardOverview counts={counts} recentOrders={(recent.data??[]) as unknown as RecentDashboardOrder[]} recentFailed={Boolean(recent.error)} dataLoadFailed={Boolean(overview.error||recent.error)} updatedAt={new Date().toISOString()}/>;
}
