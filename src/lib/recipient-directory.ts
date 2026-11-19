import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListInfo } from './operations-list';
export type DirectoryState=ListInfo&{search:string;total:number;validated:number;review:number;documents:string[]};
export async function loadRecipientDirectory(db:SupabaseClient,search:string,requested:number){
  const query=(page:number,head=false)=>{
    let q=db.from('recipient_directory').select(head?'id':'id,full_name,document_number,email,phone,created_at,updated_at,delivery_addresses',{count:'exact',head});
    if(search)q=q.ilike('search_text','%'+search+'%');
    return head?q:q.order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*50,page*50-1);
  };
  const [initial,total,validated,review]=await Promise.all([query(requested),db.from('recipient_directory').select('id',{count:'exact',head:true}),db.from('recipient_directory').select('id',{count:'exact',head:true}).eq('address_status','valid'),db.from('recipient_directory').select('id',{count:'exact',head:true}).in('address_status',['invalid','manual_review'])]);
  const count=initial.error?.code==='PGRST103'?(await query(1,true)).count:initial.count;
  const pageCount=Math.max(1,Math.ceil((count??0)/50)),page=Math.min(requested,pageCount);
  const result=page!==requested&&count!==null?await query(page):initial;
  // Keep the full document set for the import duplicate preview, independently
  // of the directory's current search/page. Server duplicate checks remain active.
  const documents:string[]=[];let documentError:unknown=null;
  for(let offset=0;;offset+=1000){
    const batch=await db.from('recipients').select('document_number').order('id',{ascending:true}).range(offset,offset+999);
    if(batch.error){documentError=batch.error;break;}
    documents.push(...(batch.data??[]).map(row=>String(row.document_number??'')));
    if((batch.data?.length??0)<1000)break;
  }
  return {data:result.data,error:result.error||total.error||validated.error||review.error||documentError,
    state:{search,page,pageCount,count:result.count??0,total:total.count??0,validated:validated.count??0,review:review.count??0,documents} satisfies DirectoryState};
}
