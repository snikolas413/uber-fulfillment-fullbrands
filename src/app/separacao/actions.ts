"use server";

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { callOmie } from '@/lib/omie/client';
import { assertSeparationOrder, readSeparationStage, type SeparationSnapshot } from '@/lib/omie/separation';

export async function sendToSeparationAction(id: string, confirmed = false) {
  let recordError: ((message: string) => Promise<void>) | undefined;
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Pedido inválido.');
    const db = await createSupabaseServerClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) throw new Error('Sua sessão expirou.');
    const { data: profile } = await db.from('user_profiles').select('role,is_active').eq('id', auth.user.id).maybeSingle();
    if (!profile?.is_active || !['admin','gestor','operador'].includes(profile.role)) throw new Error('Sem permissão para enviar pedidos à separação.');
    const { data: row, error } = await db.from('fulfillments').select('id,status,omie_order_id,separation_state,separation_omie_stage').eq('id', id).maybeSingle();
    if (error || !row?.omie_order_id || !['order_created','billing_pending'].includes(row.status)) throw new Error('Pedido indisponível para separação.');
    if (row.separation_state === 'confirmed') return { status: 'success' as const, message: 'Envio para separação já confirmado. Nenhuma troca de etapa foi repetida.' };
    recordError = async message => {
      await db.from('fulfillments').update({ omie_last_error: ('Separação: ' + message).slice(0,500) }).eq('id',id);
      await db.from('audit_logs').insert({ actor_id:auth.user!.id, entity_type:'fulfillment',entity_id:id, action:'omie.separation.failed',source:'application',after_summary:{message:message.slice(0,500)} });
    };
    const integration = 'UFB-' + id.replaceAll('-','');
    const target = await readSeparationStage(callOmie);
    const read = async () => {
      const snapshot = await callOmie<SeparationSnapshot>('/produtos/pedido/','StatusPedido',{codigo_pedido:row.omie_order_id,codigo_pedido_integracao:integration});
      assertSeparationOrder(snapshot, row.omie_order_id, integration);
      return snapshot;
    };
    const accept = async () => {
      const { error: auditError } = await db.from('audit_logs').insert({ actor_id:auth.user!.id,entity_type:'fulfillment',entity_id:id,action:'omie.separation.confirmed',source:'application',after_summary:{omie_order_id:row.omie_order_id,stage:target,no_invoice_requested:true} });
      if (auditError) throw new Error('Não foi possível registrar a conferência da separação.');
      const { data: saved, error: saveError } = await db.from('fulfillments').update({ separation_state:'confirmed',separation_omie_stage:target,separation_confirmed_at:new Date().toISOString(),status:'billing_pending',omie_last_sync_at:new Date().toISOString() })
        .eq('id',id).in('status',['order_created','billing_pending']).in('separation_state',['none','processing','unknown']).select('id').maybeSingle();
      if (saveError || !saved) throw new Error('O pedido mudou durante a conferência. Atualize a tela.');
      await db.from('fulfillments').update({omie_last_error:null}).eq('id',id).like('omie_last_error','Separação: %');
    };
    // Use distinct fresh read methods before/after the mutation so a normal
    // batch does not wait 61 seconds for a duplicate StatusPedido query.
    const { pedido_venda_produto: order } = await callOmie<{ pedido_venda_produto?: {
      cabecalho?: { codigo_pedido?: number; codigo_pedido_integracao?: string; etapa?: string; bloqueado?: string; encerrado?: string };
      infoCadastro?: { cancelado?: string; faturado?: string };
    }}>('/produtos/pedido/','ConsultarPedido',{codigo_pedido:row.omie_order_id});
    const current: SeparationSnapshot = { codigo_pedido:order?.cabecalho?.codigo_pedido,codigo_pedido_integracao:order?.cabecalho?.codigo_pedido_integracao,
      etapa:order?.cabecalho?.etapa,cancelada:order?.infoCadastro?.cancelado,faturada:order?.infoCadastro?.faturado };
    assertSeparationOrder(current,row.omie_order_id,integration);
    if (order?.cabecalho?.bloqueado === 'S' || order?.cabecalho?.encerrado === 'S') throw new Error('Pedido bloqueado ou encerrado no Omie. Confira antes de enviar para separação.');
    const { data: invoice, error: invoiceError } = await db.from('invoices').select('status,access_key,omie_invoice_number,confirmation_state').eq('fulfillment_id',id).maybeSingle();
    if (invoiceError || (invoice && (invoice.status !== 'billing_rejected' || invoice.access_key || invoice.omie_invoice_number || invoice.confirmation_state !== 'none'))) throw new Error('Existe faturamento registrado ou em conferência. Atualize o pedido antes de enviar para separação.');
    if (current.etapa === target) {
      if ((await read()).etapa !== target) throw new Error('A etapa mudou durante a conferência. Atualize o Omie.');
      await accept();
    } else {
      if (row.separation_state !== 'none') throw new Error('Envio em andamento ou sem confirmação. Apenas consulte novamente ou confira a etapa no Omie; o envio não será repetido.');
      if (!confirmed) throw new Error('Confirme o envio deste pedido para separação.');
      const { data: claim, error: claimError } = await db.from('fulfillments').update({separation_state:'processing',separation_omie_stage:target,separation_confirmed_at:null})
        .eq('id',id).eq('separation_state','none').in('status',['order_created','billing_pending']).select('id').maybeSingle();
      if (claimError || !claim) throw new Error('Este pedido já está sendo processado. Confira o resultado antes de continuar.');
      let rejected = false;
      try {
        const result = await callOmie<{codigo_status?:string;descricao_status?:string}>('/produtos/pedido/','TrocarEtapaPedido',{codigo_pedido:row.omie_order_id,codigo_pedido_integracao:integration,etapa:target});
        if (result.codigo_status != null && String(result.codigo_status) !== '0') { rejected = true; throw new Error(result.descricao_status || 'O Omie recusou o envio para separação.'); }
        if (String(result.codigo_status ?? '') !== '0') throw new Error('Resposta de envio sem confirmação.');
        if ((await read()).etapa !== target) throw new Error('O Omie ainda não confirmou a etapa de separação.');
        await accept();
      } catch (error) {
        await db.from('fulfillments').update({separation_state:rejected ? 'none' : 'unknown'}).eq('id',id).eq('separation_state','processing');
        throw error;
      }
    }
    for (const path of ['/separacao','/pedidos','/faturamento','/']) revalidatePath(path);
    return {status:'success' as const,message:'Envio para separação confirmado no Omie. Pedido liberado na tela de faturamento.'};
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha na separação.';
    await recordError?.(message);
    revalidatePath('/separacao');
    const retryAt = (error as {retryAt?:number})?.retryAt;
    return {status:'error' as const,message,...(typeof retryAt === 'number' ? {retryAt} : {})};
  }
}
