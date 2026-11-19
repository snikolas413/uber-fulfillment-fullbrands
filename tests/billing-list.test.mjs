import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/billing-list.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { loadBillingQueue, billingListParams, billingPageUrl } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

function database(rows, failure = false) {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { async fetch(input, init) {
      const url = new URL(input); requests.push(url);
      if (failure) return new Response(JSON.stringify({ message: 'Falha na consulta' }), { status: 500 });
      const expression = url.searchParams.get('status');
      const filtered = rows.filter(row => expression === 'in.(order_created,billing_pending)' ? ['order_created', 'billing_pending'].includes(row.status) && (row.separation_state === 'confirmed' || row.invoices?.length) : row.status === expression.slice(3));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit'));
      const data = filtered.slice(offset, offset + limit);
      if (init.method === 'HEAD') return new Response(null, { headers: { 'content-range': `0-0/${filtered.length}` } });
      if (offset > filtered.length) return new Response(JSON.stringify({ code: 'PGRST103', message: 'Requested range not satisfiable' }), { status: 416, headers: { 'content-type': 'application/json', 'content-range': `*/${filtered.length}` } });
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'content-range': `${offset}-${offset + data.length - 1}/${filtered.length}` } });
    } },
  });
  return { client, requests };
}
const pending = count => Array.from({ length: count }, (_, i) => ({ id: 'pending-' + i, status: i % 2 ? 'order_created' : 'billing_pending', separation_state: 'confirmed', omie_order_id: i + 1 }));

test('fila fiscal exclui pedido sem separação e preserva emissões anteriores para conferência',async()=>{
  const {client,requests}=database([
    {id:'sem-separacao',status:'order_created',separation_state:'none'},
    {id:'liberado',status:'billing_pending',separation_state:'confirmed'},
    {id:'emissao-anterior',status:'billing_pending',separation_state:'none',invoices:[{status:'billing_unknown'}]},
  ]);
  const result=await loadBillingQueue(client,'pending',1);
  assert.deepEqual(result.data.map(row=>row.id),['liberado','emissao-anterior']);
  assert.equal(requests[0].searchParams.get('or'),'(separation_state.eq.confirmed,invoices.not.is.null)');
});

test('1000 pedidos aguardando faturamento ficam acessíveis em dez páginas sem perda ou repetição', async () => {
  const { client, requests } = database(pending(1000));
  const ids = [];
  for (let page = 1; page <= 10; page++) {
    const result = await loadBillingQueue(client, 'pending', page);
    assert.equal(result.error, null);
    assert.deepEqual(result.state, { page, pageCount: 10, count: 1000 });
    assert.equal(result.data.length, 100);
    ids.push(...result.data.map(row => row.id));
  }
  assert.equal(new Set(ids).size, 1000);
  assert.ok(requests.every(url => url.searchParams.get('limit') === '100'));
  assert.equal(requests[9].searchParams.get('offset'), '900');
  assert.ok(requests.every(url => url.searchParams.get('order') === 'created_at.asc,id.asc'));
});

test('filas têm totais e páginas independentes, inclusive além do limite padrão de 1000 registros', async () => {
  const { client } = database([...pending(1105), ...Array.from({ length: 120 }, (_, i) => ({ id: 'billed-' + i, status: 'billed' })), ...Array.from({ length: 101 }, (_, i) => ({ id: 'ready-' + i, status: 'ready' })), { id: 'error', status: 'order_pending' }]);
  const p = await loadBillingQueue(client, 'pending', 12);
  const b = await loadBillingQueue(client, 'billed', 2);
  const r = await loadBillingQueue(client, 'prepared', 2);
  assert.equal(p.data.length, 5); assert.equal(p.state.count, 1105);
  assert.equal(b.data.length, 20); assert.equal(b.state.count, 120);
  assert.equal(r.data.length, 1); assert.equal(r.state.count, 101);
  assert.ok(p.data.every(row => row.omie_order_id));
  assert.ok(b.data.every(row => row.status === 'billed'));
});

test('página inexistente após faturar é ajustada sem esconder a fila', async () => {
  const { client, requests } = database(pending(1000));
  const result = await loadBillingQueue(client, 'pending', 11);
  assert.equal(result.error, null);
  assert.deepEqual(result.state, { page: 10, pageCount: 10, count: 1000 });
  assert.equal(result.data[0].id, 'pending-900');
  assert.equal(requests.length, 2);
  const empty = await loadBillingQueue(database([]).client, 'pending', 8);
  assert.equal(empty.error, null);
  assert.deepEqual(empty.state, { page: 1, pageCount: 1, count: 0 });
});

test('parâmetros inválidos são tratados e navegar em uma fila preserva as outras páginas', () => {
  assert.deepEqual(billingListParams({ pending_page: '-1', prepared_page: ['2'], billed_page: 'abc' }), { prepared: 1, pending: 1, billed: 1 });
  const pages = billingListParams({ pending_page: '4', prepared_page: '2', billed_page: '3' });
  const url = new URL(billingPageUrl(pages, 'pending', 5), 'https://example.test');
  assert.equal(url.searchParams.get('pending_page'), '5');
  assert.equal(url.searchParams.get('prepared_page'), '2');
  assert.equal(url.searchParams.get('billed_page'), '3');
});

test('falha na consulta é informada sem repetir nem chamar o Omie', async () => {
  const { client, requests } = database([], true);
  const result = await loadBillingQueue(client, 'pending', 1);
  assert.ok(result.error);
  assert.equal(result.data, null);
  assert.equal(requests.length, 1);
});

test('página de faturamento usa o total global e entrega somente a página escolhida para seleção', async () => {
  const { client } = database(pending(1000));
  const server = { auth: { async getUser() { return { data: { user: { id: 'user' } } }; } }, from(table) {
    if (table !== 'user_profiles') return client.from(table);
    const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: { role: 'operador', is_active: true } }; } };
    return query;
  } };
  const modules = {
    'next/navigation': { redirect() { assert.fail('Sessão autorizada'); } },
    '@/lib/supabase/server': { async createSupabaseServerClient() { return server; } },
    '@/lib/billing-list': { billingListParams, billingPageUrl, loadBillingQueue },
    './billing-management': { BillingManagement(props) {
      assert.equal(props.list.pending.count, 1000);
      assert.equal(props.list.pending.page, 3);
      assert.equal(props.rows.length, 100);
      assert.equal(props.rows[0].id, 'pending-200');
      return React.createElement('div', null, 'Fila fiscal paginada');
    } },
  };
  const exports = {}, nativeRequire = createRequire(import.meta.url);
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../src/app/faturamento/page.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => name in modules ? modules[name] : nativeRequire(name), exports);
  const html = renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve({ pending_page: '3' }) }));
  assert.match(html, /<strong>1000<\/strong><small>Pendentes de faturamento/);
  assert.match(html, /<strong>1000<\/strong><small>Registros acompanhados/);
  assert.match(html, /Fila fiscal paginada/);
});
