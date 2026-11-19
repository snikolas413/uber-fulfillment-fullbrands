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
const base = { counts: { recipients: 12, orders: 8, billing: 2, shipped: 1,prepared:3,separation:4,confirming:0,billed:2,labels:1,shipping:0,attention:0,cancelled:0 }, recentOrders: [], recentFailed: false, dataLoadFailed: false, updatedAt: '2026-11-11T17:30:00Z' };

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

test('painel usa o consolidado protegido e consulta seis pedidos sem chamar o Omie',async()=>{
 const calls=[];const counts={recipients:3766,orders:988,prepared:59,separation:839,billing:0,confirming:0,billed:90,labels:90,shipping:0,attention:11,shipped:0,cancelled:1};
 const db={auth:{async getUser(){return{data:{user:{id:'user'}}};}},async rpc(name){calls.push(name);return{data:counts,error:null};},from(table){calls.push(table);const q={select(){return q;},eq(){return q;},order(){return q;},limit(n){assert.equal(n,6);return q;},async maybeSingle(){return{data:{is_active:true}};},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};return q;}};
 const page=load('../src/app/page.tsx',{'@/lib/supabase/server':{async createSupabaseServerClient(){return db;}},'./dashboard-overview':view,'next/navigation':{redirect(){assert.fail('Autorizado');}}});
 const html=renderToStaticMarkup(await page.default());assert.match(html,/839 pedidos aguardando separação/);assert.match(html,/NF-e autorizadas/);assert.match(html,/>90</);assert.ok(calls.includes('operation_overview'));assert.ok(calls.includes('operation_orders'));
});
