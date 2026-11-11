import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const nativeRequire = createRequire(import.meta.url);
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', code)(name => name in modules ? modules[name] : nativeRequire(name), exports);
  return exports;
}
const view = load('../src/app/dashboard-overview.tsx', {
  'next/link': props => React.createElement('a', props, props.children),
  './dashboard.module.css': { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) },
});
const base = { counts: { recipients: 12, orders: 8, billing: 2, shipped: 1 }, recentOrders: [], recentFailed: false, dataLoadFailed: false, updatedAt: '2026-11-11T17:30:00Z' };

test('dashboard apresenta dados, links e estados vazios/indisponíveis, sem controles operacionais', () => {
  const html = renderToStaticMarkup(React.createElement(view.DashboardOverview, { ...base, recentOrders: [{ id: 'one', status: 'label_ready', created_at: base.updatedAt, omie_order_number: '00001146', recipients: [{ full_name: 'Destinatário Exemplo' }], invoices: [{ omie_invoice_number: '00001243' }] }] }));
  assert.match(html, /#1146/); assert.match(html, /NF-e 1243/); assert.match(html, /Etiqueta disponível/);
  for (const path of ['/pedidos', '/destinatarios', '/faturamento', '/expedicao', '/historico']) assert.ok(html.includes(`href="${path}"`));
  assert.ok(!/<(button|form|input)\b/.test(html));
  assert.ok(!html.includes('Credenciais pendentes'));
  const empty = renderToStaticMarkup(React.createElement(view.DashboardOverview, base));
  assert.match(empty, /primeiro pedido/);
  const failed = renderToStaticMarkup(React.createElement(view.DashboardOverview, { ...base, counts: { ...base.counts, billing: null }, recentFailed: true, dataLoadFailed: true }));
  assert.match(failed, /Consulta indisponível/); assert.match(failed, /Alguns dados não puderam ser atualizados/);
  assert.ok(!failed.includes('0 pedidos na fila'));
});

test('consultas mantêm os critérios dos indicadores e carregam apenas seis pedidos recentes sem gravações', async () => {
  const calls = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const query = {
        select(fields, options) { call.fields = fields; call.options = options; return query; },
        eq(...args) { call.filters.push(['eq', ...args]); return query; }, neq(...args) { call.filters.push(['neq', ...args]); return query; }, in(...args) { call.filters.push(['in', ...args]); return query; },
        order(...args) { call.order = args; return query; }, limit(value) { call.limit = value; return query; },
        then(resolve) { return Promise.resolve({ count: 3, data: [], error: null }).then(resolve); },
      };
      return query;
    },
  };
  const page = load('../src/app/page.tsx', { '@/lib/supabase/server': { createSupabaseServerClient: async () => db }, './dashboard-overview': view });
  const element = await page.default();
  assert.ok(element);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.slice(0, 4).map(call => call.filters), [[], [['neq', 'status', 'cancelled']], [['in', 'status', ['order_created', 'billing_pending']]], [['eq', 'status', 'shipped']]]);
  assert.equal(calls[4].limit, 6);
  assert.deepEqual(calls[4].order, ['created_at', { ascending: false }]);
  assert.ok(calls.slice(0, 4).every(call => call.options.count === 'exact' && call.options.head === true));
});
