import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const nativeRequire = createRequire(import.meta.url);
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', code)(name => name in modules ? modules[name] : nativeRequire(name), exports);
  return exports;
}
const { BillingManagement } = load('../src/app/faturamento/billing-management.tsx', {
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
  '@/app/pedidos/omie-actions': { invoiceOrderAction: () => assert.fail('Renderização não pode solicitar emissão') },
  '@/components/omie-action-button': { OmieActionButton: () => React.createElement('button', null, 'Atualizar Omie') },
  '@/lib/omie/billing-batch': load('../src/lib/omie/billing-batch.ts'),
  '@/lib/omie/freight-selection': load('../src/lib/omie/freight-selection.ts'),
});
const base = { id: 'pedido-1', status: 'order_created', omie_order_id: 555, omie_order_number: '1140', omie_last_error: null,
  created_at: '2026-11-10T12:00:00Z', recipients: { full_name: 'Destinatário teste' }, invoices: null,
  shipments: { carrier_id: '123', service_code: '04227', freight_amount: 0 } };

test('tela permite selecionar pedido preparado e bloqueia NF existente, tentativa incerta e frete pendente', () => {
  const html = renderToStaticMarkup(React.createElement(BillingManagement, { canBill: true, rows: [base,
    { ...base, id: 'pedido-2', omie_order_number: '1141', invoices: { status: 'billing_unknown' } },
    { ...base, id: 'pedido-3', omie_order_number: '1142', invoices: { omie_invoice_number: '123', status: 'faturada' } },
    { ...base, id: 'pedido-4', omie_order_number: '1143', omie_last_error: 'Frete: Pendente' },
  ] }));
  const inputs = html.match(/<input[^>]*>/g);
  assert.equal(inputs.length, 5);
  assert.ok(!inputs.find(input => input.includes('Selecionar pedido 1140')).includes('disabled'));
  for (const number of ['1141', '1142', '1143']) assert.ok(inputs.find(input => input.includes('Selecionar pedido ' + number)).includes('disabled'));
  assert.match(html, /Faturar selecionados/);
});

test('perfil consulta não recebe controles de seleção ou emissão', () => {
  const html = renderToStaticMarkup(React.createElement(BillingManagement, { canBill: false, rows: [base] }));
  assert.ok(!html.includes('type="checkbox"'));
  assert.ok(!html.includes('Faturar selecionados'));
  assert.match(html, /Atualizar Omie/);
});
