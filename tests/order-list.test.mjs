import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/order-list.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { loadOrderList, orderListParams } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

function database(rows) {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { async fetch(input, init) {
      const url = new URL(input);
      requests.push(url);
      let filtered = rows;
      for (const [field, expression] of url.searchParams) {
        if (field === 'status') {
          if (expression.startsWith('eq.')) filtered = filtered.filter(row => row.status === expression.slice(3));
          if (expression === 'not.in.(ready,cancelled)') filtered = filtered.filter(row => !['ready', 'cancelled'].includes(row.status));
        }
        if (field === 'omie_order_id') filtered = filtered.filter(row => expression === 'is.null' ? row.omie_order_id === null : row.omie_order_id !== null);
      }
      const total = filtered.length;
      const start = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? total);
      const data = filtered.slice(start, start + limit);
      return new Response(init.method === 'HEAD' ? null : JSON.stringify(data), {
        status: 200, headers: { 'content-type': 'application/json', 'content-range': `${start}-${start + data.length - 1}/${total}` },
      });
    } },
  });
  return { client, requests };
}

const prepared = count => Array.from({ length: count }, (_, i) => ({ id: String(i), status: 'ready', omie_order_id: null }));

test('174 pedidos preparados ficam acessíveis em duas páginas sem repetição e com totais globais', async () => {
  const { client } = database(prepared(174));
  const first = await loadOrderList(client, orderListParams({}));
  const second = await loadOrderList(client, orderListParams({ page: '2' }));
  assert.equal(first.error, undefined);
  assert.equal(first.state.count, 174);
  assert.equal(first.state.pageCount, 2);
  assert.equal(first.data.length, 100);
  assert.equal(second.data.length, 74);
  assert.equal(new Set([...first.data, ...second.data].map(row => row.id)).size, 174);
  assert.deepEqual(second.state.totals, { pending: 174, sent: 0, review: 0, cancelled: 0, all: 174 });
});

test('paginação alcança mais de 1000 pedidos e ajusta página que deixou de existir após envio', async () => {
  const { client } = database(prepared(1074));
  const last = await loadOrderList(client, orderListParams({ page: '999' }));
  assert.equal(last.state.page, 11);
  assert.equal(last.state.pageCount, 11);
  assert.equal(last.data.length, 74);
  assert.equal(last.data[0].id, '1000');
});

test('filtros separam ID Omie confirmado, preparados, tentativas incertas e cancelados', async () => {
  const rows = [
    ...prepared(174),
    ...['order_created', 'billing_pending', 'billed', 'shipped', 'error', 'cancelled'].map((status, i) => ({ id: `sent-${i}`, status, omie_order_id: 100 + i })),
    ...['order_pending', 'error'].map(status => ({ id: status, status, omie_order_id: null })),
    { id: 'cancelled', status: 'cancelled', omie_order_id: null },
  ];
  const { client } = database(rows);
  const sent = await loadOrderList(client, orderListParams({ view: 'sent' }));
  assert.equal(sent.data.length, 6);
  assert.ok(sent.data.every(row => row.omie_order_id));
  assert.deepEqual(sent.state.totals, { pending: 174, sent: 6, review: 2, cancelled: 1, all: 183 });
  const review = await loadOrderList(client, orderListParams({ view: 'review' }));
  assert.deepEqual(review.data.map(row => row.id), ['order_pending', 'error']);
});

test('busca e ordenação são enviadas ao servidor e parâmetros inválidos são tratados', async () => {
  const { client, requests } = database(prepared(174));
  const params = orderListParams({ view: 'all', q: 'João', page: '2' });
  await loadOrderList(client, params);
  const url = requests.find(url => url.searchParams.has('offset'));
  assert.equal(url.searchParams.get('offset'), '100');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('order'), 'created_at.desc,id.desc');
  assert.equal(url.searchParams.get('matching_recipient.full_name'), 'ilike.%João%');
  assert.match(url.searchParams.get('or'), /matching_recipient.not.is.null/);
  assert.match(url.searchParams.get('or'), /omie_order_number.ilike/);
  assert.deepEqual(orderListParams({ view: 'invalid', page: '-2', q: 'a),id.eq.*' }), { view: 'pending', page: 1, search: 'a  id.eq.' });
  assert.equal(orderListParams({ q: 'nome+teste@example.com' }).search, 'nome+teste@example.com');
});
