import type { SupabaseClient } from '@supabase/supabase-js';
export type ListInfo = {page:number;pageCount:number;count:number};
export const billingViews = {ready:'Prontos para faturar',confirming:'Aguardando NF-e',attention:'Com pendência',billed:'Faturados'};
export const shippingViews = {pending:'Gerar etiquetas',ready:'Prontas para imprimir',attention:'Conferir pendências',shipped:'Marcados como enviados'};
export const separationViews = {awaiting:'Aguardando envio',attention:'Conferir pendências',confirmed:'Envio confirmado'};
export function listParams(params:Record<string,string|string[]|undefined>,views:Record<string,string>,fallback:string){
  const view=typeof params.view==='string'&&params.view in views?params.view:fallback;
  const page=typeof params.page==='string'&&/^\d{1,7}$/.test(params.page)?Math.max(1,Number(params.page)):1;
  const search=typeof params.q==='string'?params.q.replace(/[^\p{L}\p{N}\s@.+-]/gu,' ').trim().slice(0,100):'';
  return {view,page,search};
}
export function listUrl(path:string,view:string,search='',page=1){return path+'?'+new URLSearchParams({view,q:search,page:String(page)});}
export async function loadOperationList(db:SupabaseClient,kind:'billing'|'shipping'|'separation',params:ReturnType<typeof listParams>){
  const query=(page:number,head=false)=>{
    let q=db.from('operation_orders').select(head?'id':'*',{count:'exact',head}).eq(kind+'_queue',params.view);
    if(params.search)q=q.ilike('search_text','%'+params.search+'%');
    return head?q:q.order('created_at',{ascending:params.view!=='billed'&&params.view!=='shipped'}).order('id',{ascending:true}).range((page-1)*100,page*100-1);
  };
  const initial=await query(params.page);
  const count=initial.error?.code==='PGRST103'?(await query(1,true)).count:initial.count;
  const pageCount=Math.max(1,Math.ceil((count??0)/100)),page=Math.min(params.page,pageCount);
  const result=page!==params.page&&count!==null?await query(page):initial;
  return {...result,state:{page,pageCount,count:result.count??0} satisfies ListInfo};
}
export async function operationTotals(db:SupabaseClient,kind:'billing'|'shipping'|'separation',views:Record<string,string>){
  const entries=await Promise.all(Object.keys(views).map(async view=>{
    const {count,error}=await db.from('operation_orders').select('id',{count:'exact',head:true}).eq(kind+'_queue',view);
    return [view,error?null:count??0] as const;
  }));
  return Object.fromEntries(entries) as Record<string,number|null>;
}
export const cleanNumber=(value:string|null|undefined)=>value?.replace(/^0+(?=\d)/,'')||'—';
export function formatInvoiceDate(value:string|null|undefined){
  if(!value||!Number.isFinite(Date.parse(value)))return '—';
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value)||/T00:00:00(?:\.0+)?(?:Z|\+00:00)$/.test(value);
  return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:dateOnly?'UTC':'America/Sao_Paulo'}).format(new Date(dateOnly?value.slice(0,10)+'T12:00:00Z':value));
}
