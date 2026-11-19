"use client";
import { useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendToSeparationAction } from './actions';
import { cleanNumber } from '@/lib/operations-list';
import { OperationNotice } from '@/components/operation-notice';
import { OmieActionButton } from '@/components/omie-action-button';
type Relation<T> = T|T[]|null;
export type SeparationRow={id:string;omie_order_number:string|null;omie_last_error:string|null;separation_state:string;delivery_recipient_name:string|null;
  recipients:Relation<{full_name:string}>;fulfillment_items:{description:string;quantity:number}[];
  invoices:Relation<{status:string;access_key:string|null;omie_invoice_number:string|null}>};
const first=<T,>(value:Relation<T>)=>Array.isArray(value)?value[0]??null:value;
type Result=Awaited<ReturnType<typeof sendToSeparationAction>>;
export function SeparationManagement({rows,canSend,count}:{rows:SeparationRow[];canSend:boolean;count:number}) {
  const router=useRouter(),busy=useRef(false);
  const [batchIds,setBatchIds]=useState<string[]>([]);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[results,setResults]=useState<Record<string,Result>>({}),[running,setRunning]=useState(false),[confirming,setConfirming]=useState(false),[active,setActive]=useState<string|null>(null);
  const blocked=(row:SeparationRow)=>{const invoice=first(row.invoices);return results[row.id]?.status==='success'||Boolean(invoice&&(invoice.status!=='billing_rejected'||invoice.access_key||invoice.omie_invoice_number));};
  const eligible=rows.filter(row=>!blocked(row)&&row.separation_state==='none');
  const chosen=eligible.filter(row=>selected.has(row.id));
  const all=eligible.length>0&&eligible.every(row=>selected.has(row.id));
  async function run(ids:string[],send:boolean){
    if(!canSend||busy.current||!ids.length||ids.length>100)return;
    busy.current=true;setRunning(true);setConfirming(false);setBatchIds(ids);
    setResults(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!ids.includes(id))));
    try{for(const id of ids){setActive(id);let result:Result;try{result=await sendToSeparationAction(id,send);}catch{result={status:'error',message:'Resposta não recebida. Confira o Omie antes de repetir o envio.'};}setResults(previous=>({...previous,[id]:result}));}}
    finally{busy.current=false;setRunning(false);setActive(null);setSelected(new Set());router.refresh();}
  }
  return <section className="panel orders-panel"><div className="recipient-toolbar"><div><span className="section-kicker">FILA DE SEPARAÇÃO</span><h2>Pedidos aguardando envio</h2><small>{rows.length} de {count} pedido(s)</small></div>{canSend&&<div><button className="primary-button" disabled={running||!chosen.length} onClick={()=>setConfirming(true)}>Enviar selecionados para separação ({chosen.length})</button></div>}</div>
    {confirming&&<div className="orders-notice"><div><strong>Confirmar envio de {chosen.length} pedido(s) para separação no Omie?</strong><p>{chosen.map(row=>'#'+row.omie_order_number).join(', ')}</p><button className="primary-button" disabled={running} onClick={()=>run(chosen.map(row=>row.id),true)}>Confirmar envio para separação</button> <button className="secondary-button" onClick={()=>setConfirming(false)}>Cancelar</button></div></div>}
    {batchIds.length>0&&<div className="billing-progress" role="status"><strong>{running?'Processando':'Lote encerrado'}: {batchIds.filter(id=>results[id]).length} de {batchIds.length} pedido(s)</strong><span>{batchIds.filter(id=>results[id]?.status==='success').length} confirmado(s) · {batchIds.filter(id=>results[id]?.status==='error').length} com erro</span>{running&&<small>Mantenha esta tela aberta. Pedidos com erro ficam registrados e o lote segue para o próximo.</small>}</div>}
    <div className="orders-table-wrap"><table className="orders-table"><thead><tr>{canSend&&<th><input type="checkbox" aria-label="Selecionar todos para separação" checked={all} disabled={running||confirming||!eligible.length} onChange={e=>setSelected(new Set(e.target.checked?eligible.map(row=>row.id):[]))}/></th>}<th>PEDIDO OMIE</th><th>DESTINATÁRIO</th><th>ITENS</th><th>SITUAÇÃO / AVISOS</th><th>AÇÕES</th></tr></thead><tbody>{rows.map(row=>{
      const result=results[row.id],uncertain=['processing','unknown'].includes(row.separation_state);
      return <tr key={row.id}>{canSend&&<td><input type="checkbox" aria-label={'Selecionar pedido '+row.omie_order_number} checked={selected.has(row.id)} disabled={running||confirming||blocked(row)||uncertain} onChange={e=>setSelected(previous=>{const next=new Set(previous);if(e.target.checked)next.add(row.id);else next.delete(row.id);return next;})}/></td>}<td><strong>{cleanNumber(row.omie_order_number)}</strong></td><td>{row.delivery_recipient_name??first(row.recipients)?.full_name??'—'}</td><td>{row.fulfillment_items?.map((item,index)=><small key={index}>{item.quantity} × {item.description}</small>)}</td><td><span>{active===row.id?'Processando...':result?.status==='success'?'Envio confirmado':row.separation_state==='confirmed'?'Envio confirmado':uncertain?'Conferir envio no Omie':blocked(row)?'Conferir faturamento existente':'Aguardando separação'}</span>{(result?.message||row.omie_last_error)&&<OperationNotice message={result?.message??row.omie_last_error} status={result?.status}/>}</td><td>{canSend&&!blocked(row)&&<button className="secondary-button" disabled={running||confirming} onClick={()=>run([row.id],false)}>Conferir no Omie</button>}{canSend&&blocked(row)&&<OmieActionButton fulfillmentId={row.id} kind="sync-order" size="small" disabled={running||confirming}/>}</td></tr>;
    })}</tbody></table>{!rows.length&&<div className="recipient-empty"><strong>Nenhum pedido aguardando separação</strong></div>}</div>
  </section>;
}
