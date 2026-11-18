// Explicit maintenance only. This script cannot issue invoices or create orders.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2] ?? 'inspect';
if (!['inspect', 'pilot', 'pilot-verify', 'apply', 'verify'].includes(mode)) throw new Error('Invalid mode');
const env = parseEnv(readFileSync(process.argv[3], 'utf8'));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const dir = 'outputs/payment-policy-2026-11-18';
mkdirSync(dir, { recursive: true });
const dueDate = '31/12/2026';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const allow = new Set(['ListarPedidos', 'ConsultarPedido', 'AlterarPedidoVenda']);
async function request(method, params) {
  if (!allow.has(method)) throw new Error('Operation is not allowed');
  const lease = randomUUID();
  const reservation = await db.rpc('acquire_omie_request', { p_lease: lease });
  if (reservation.error || !reservation.data?.granted) throw new Error('API unavailable or paused: ' + (reservation.data?.retry_at ?? reservation.error?.message));
  await sleep(Math.max(0, Math.min(1000, Number(reservation.data.wait_ms) || 0)));
  let pause = 0;
  try {
    const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: method, app_key: env.OMIE_APP_KEY, app_secret: env.OMIE_APP_SECRET, param: [params] }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    const code = data.codigo_status ?? data.cCodStatus;
    if (!response.ok || data.faultstring || (code != null && String(code) !== '0')) {
      pause = response.status === 425 || /consumo indevido|bloquead/i.test(data.faultstring ?? '') ? 1800 : 61;
      throw new Error(method + ': ' + (data.faultstring ?? data.descricao_status ?? data.cDescStatus ?? response.status));
    }
    return data;
  } catch (error) { pause ||= 61; throw error; }
  finally {
    const finished = await db.rpc('finish_omie_request', { p_lease: lease, p_pause_seconds: pause });
    if (finished.error || finished.data !== true) throw new Error('API reservation was not released; stop and inspect');
  }
}

function compliant(order) {
  const parts=order.lista_parcelas?.parcela;
  return order.det?.length > 0 && order.det.every(item => item.inf_adic?.nao_gerar_financeiro === 'S') &&
    (!parts?.length || parts.every(part => part.data_vencimento === dueDate && part.nao_gerar_boleto === 'S'));
}
function protectedHash(order) {
  // Exclude only the three explicitly authorized financial changes and Omie timestamps.
  return createHash('sha256').update(JSON.stringify({
    customer: order.cabecalho.codigo_cliente, integration: order.cabecalho.codigo_pedido_integracao,
    stage: order.cabecalho.etapa, scenario: order.cabecalho.codigo_cenario_impostos,
    items: order.det.map(item => ({ ide: item.ide, produto: item.produto, imposto: item.imposto,
      inf_adic: Object.fromEntries(Object.entries(item.inf_adic ?? {}).filter(([key]) => key !== 'nao_gerar_financeiro')) })),
    freight: order.frete, additional: order.informacoes_adicionais, total: order.total_pedido,
  })).digest('hex');
}
function assertTarget(order, row) {
  if (order?.cabecalho?.codigo_pedido !== row.omie_order_id || order.cabecalho.codigo_pedido_integracao !== 'UFB-' + row.id.replaceAll('-', '')) throw new Error('Order link mismatch: ' + row.omie_order_number);
  if (order.infoCadastro?.cancelado === 'S' || order.infoCadastro?.faturado === 'S' || !['10','20','30','40','50'].includes(order.cabecalho.etapa)) throw new Error('Order no longer editable: ' + row.omie_order_number);
}
function patch(order) {
  const parts = order.lista_parcelas?.parcela;
  if (!parts?.length || !order.det?.length) throw new Error('Missing installment or items');
  return {
    cabecalho: { codigo_pedido: order.cabecalho.codigo_pedido, codigo_pedido_integracao: order.cabecalho.codigo_pedido_integracao,
      codigo_parcela: '999', qtde_parcelas: parts.length, nao_gerar_boleto: 'S' },
    det: order.det.map(item => {
      if (!Number.isSafeInteger(item.ide?.codigo_item)) throw new Error('Missing item ID');
      return { ide: { codigo_item: item.ide.codigo_item }, inf_adic: { nao_gerar_financeiro: 'S' } };
    }),
    lista_parcelas: { parcela: parts.map(part => ({ ...part, data_vencimento: dueDate, nao_gerar_boleto: 'S' })) },
  };
}
async function localRows() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('fulfillments').select('id,omie_order_id,omie_order_number,status')
      .in('status', ['order_created','billing_pending']).not('omie_order_id','is',null).order('id').range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data); if (data.length < 1000) break;
  }
  return rows;
}
async function listOrders() {
  const orders = new Map();
  for (let pagina = 1; ; pagina++) {
    const data = await request('ListarPedidos', { pagina, registros_por_pagina: 100, apenas_resumo: 'N', filtrar_por_cliente: 2867720329 });
    for (const order of data.pedido_venda_produto ?? []) orders.set(order.cabecalho.codigo_pedido, order);
    console.log(JSON.stringify({ mode, page: pagina, pages: data.total_de_paginas, orders: orders.size }));
    if (pagina >= data.total_de_paginas) break;
  }
  return orders;
}
const rows = await localRows();
if (mode === 'pilot-verify') {
  const data = await request('ListarPedidos', { pagina:1, registros_por_pagina:20, apenas_resumo:'N',numero_pedido_de:1316,numero_pedido_ate:1316 });
  console.log(JSON.stringify({keys:Object.keys(data),orders:data.pedido_venda_produto?.map(order=>({keys:Object.keys(order),header:order.cabecalho,installments:order.lista_parcelas,items:order.det.map(item=>({finance:item.inf_adic?.nao_gerar_financeiro})),compliant:compliant(order)}))}));
  process.exit(0);
}
const selectedRows = mode === 'pilot' ? rows.filter(row => row.omie_order_number.endsWith('1316')) : rows;
const orders = mode === 'pilot'
  ? new Map(await Promise.all(selectedRows.map(async row => [row.omie_order_id, (await request('ConsultarPedido', { codigo_pedido: row.omie_order_id })).pedido_venda_produto])))
  : await listOrders();
const targets = selectedRows.map(row => { const order = orders.get(row.omie_order_id); assertTarget(order, row); return { row, order }; });
if (mode === 'inspect') {
  writeFileSync(dir + '/before.json', JSON.stringify(targets.map(({row,order}) => ({ row,
    financial: { cabecalho: order.cabecalho, det: order.det.map(item => ({ ide:item.ide,inf_adic:item.inf_adic })), lista_parcelas:order.lista_parcelas },
    protectedHash:protectedHash(order) })), null, 2));
  const example=targets.find(x=>x.row.omie_order_number.endsWith('1316'))??targets[0];
  console.log(JSON.stringify({ targets:targets.length, compliant:targets.filter(x=>compliant(x.order)).length,
    sample:{ number:example.row.omie_order_number, header:example.order.cabecalho, installments:example.order.lista_parcelas,
      items:example.order.det.map(i=>({ide:i.ide,finance:i.inf_adic?.nao_gerar_financeiro})) } }));
} else if (mode === 'verify') {
  const before = new Map(JSON.parse(readFileSync(dir + '/before.json','utf8')).map(item=>[item.row.id,item]));
  const failures = targets.flatMap(({row,order}) => compliant(order) && protectedHash(order) === before.get(row.id)?.protectedHash ? [] : [{number:row.omie_order_number,policy:compliant(order),preserved:protectedHash(order)===before.get(row.id)?.protectedHash}]);
  writeFileSync(dir+'/verification.json',JSON.stringify({checkedAt:new Date().toISOString(),targets:targets.length,verified:targets.length-failures.length,failures},null,2));
  console.log(JSON.stringify({targets:targets.length,verified:targets.length-failures.length,failures:failures.slice(0,10)}));
  if(failures.length) process.exitCode=1;
} else {
  if (!existsSync(dir + '/before.json')) throw new Error('Inspect and back up before changing orders');
  const chosen = mode==='pilot' ? targets.filter(x=>x.row.omie_order_number.endsWith('1316')) : targets;
  for (let index=0; index<chosen.length; index++) {
    const {row,order}=chosen[index];
    if (compliant(order)) continue;
    const result=await request('AlterarPedidoVenda',patch(order));
    appendFileSync(dir+'/changes.jsonl',JSON.stringify({at:new Date().toISOString(),id:row.id,number:row.omie_order_number,code:result.codigo_status,policy:{dueDate,noReceivables:true,noBoleto:true}})+'\n');
    const {error}=await db.from('audit_logs').insert({entity_type:'fulfillment',entity_id:row.id,action:'omie.payment_policy.updated',source:'authorized_maintenance',after_summary:{due_date:dueDate,no_receivables:true,no_boleto:true,no_invoice_requested:true}});
    if(error) throw error;
    console.log(JSON.stringify({mode,updated:index+1,total:chosen.length,number:row.omie_order_number}));
    if(mode==='pilot') {
      // Omie forbids repeating the same fresh order read within a minute.
      await sleep(61_000);
      const saved=(await request('ConsultarPedido',{codigo_pedido:row.omie_order_id})).pedido_venda_produto;
      assertTarget(saved,row);
      console.log(JSON.stringify({pilotVerified:compliant(saved),protectedFieldsPreserved:protectedHash(saved)===protectedHash(order),header:saved.cabecalho,installments:saved.lista_parcelas}));
      if(!compliant(saved)||protectedHash(saved)!==protectedHash(order)) throw new Error('Pilot verification failed; do not run batch');
    }
  }
}
