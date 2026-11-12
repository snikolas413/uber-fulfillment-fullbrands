import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';

function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (!(name in modules)) throw new Error('Unexpected module ' + name);
    return modules[name];
  }, exports);
  return exports;
}
const batch = load('../src/lib/omie/order-send-batch.ts');

test('envio em lote é sequencial, só usa selecionados e nunca autoriza reinclusão', async () => {
  const calls = [], results = [];
  let active = false;
  await batch.runOrderSendBatch(['one', 'lost', 'one', 'last'], {
    async send(id, confirmRetry) {
      assert.equal(active, false); assert.equal(confirmRetry, false); active = true;
      await Promise.resolve(); active = false; calls.push(id);
      if (id === 'lost') throw new Error('Timeout');
      return { status: 'success', message: 'Pedido criado e Mini Envios selecionado' };
    }, onStart() {}, onResult(id, result) { results.push([id, result]); }, shouldStop: () => false,
  });
  assert.deepEqual(calls, ['one', 'lost', 'last']);
  assert.equal(results[1][1].status, 'warning');
  assert.match(results[1][1].message, /Atualizar Omie/);
  assert.equal(results[2][1].status, 'success');
});

test('interrompe somente depois do pedido atual e bloqueia lotes fora do limite', async () => {
  let stopped = false;
  const calls = [];
  const options = { async send(id) { calls.push(id); return { status: 'warning', message: 'Revisar frete' }; }, onStart() {}, onResult() { stopped = true; }, shouldStop: () => stopped };
  await batch.runOrderSendBatch(['one', 'two'], options);
  assert.deepEqual(calls, ['one']);
  for (const ids of [[], Array.from({ length: 101 }, (_, i) => String(i))]) await assert.rejects(batch.runOrderSendBatch(ids, options));
});

test('seleção só admite preparados sem ID Omie; tentativas pendentes e pedidos avançados ficam fora do lote', () => {
  assert.equal(batch.canSendPreparedOrder({ status: 'ready', omie_order_id: null }), true);
  for (const status of ['order_pending', 'error', 'order_created', 'billing_pending', 'billed', 'cancelled']) {
    assert.equal(batch.canSendPreparedOrder({ status, omie_order_id: null }), false);
  }
  assert.equal(batch.canSendPreparedOrder({ status: 'ready', omie_order_id: 123 }), false);
});

test('lista mostra seleção e botão de lote só para escrita; abrir página não envia pedidos', () => {
  const { OrderManagement } = load('../src/app/pedidos/order-management.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    './order-batch-modal': { OrderBatchModal: () => null },
    '@/components/omie-action-button': { OmieActionButton: () => null },
    '@/app/expedicao/shipping-editor': { ShippingEditor: () => null },
    './omie-actions': { sendOrderToOmieAction() { assert.fail('Renderização não pode enviar'); } },
    '@/lib/omie/order-send-batch': batch,
    '@/lib/order-list': { ORDER_PAGE_SIZE: 100 },
  });
  const drafts = ['ready', 'order_pending', 'billed'].map((status, i) => ({ id: String(i), status, omie_order_id: status === 'billed' ? 123 : null, created_at: '2026-11-11', recipients: { full_name: 'Pessoa ' + i }, fulfillment_items: [] }));
  const list = { view: 'pending', search: '', page: 1, pageCount: 2, count: 174, totals: { all: 174, pending: 174, sent: 0, review: 0, cancelled: 0 } };
  const render = canWrite => renderToStaticMarkup(React.createElement(OrderManagement, { drafts, recipients: [], canWrite, list }));
  const writable = render(true);
  assert.match(writable, /Enviar selecionados ao Omie/);
  assert.match(writable, /Página 1 de 2/);
  assert.match(writable, /100 de 174 pedido/);
  assert.match(writable, /Aguardando envio \(174\)/);
  assert.match(writable, /Enviados ao Omie \(0\)/);
  assert.match(writable, /aria-label="Selecionar pedido de Pessoa 0"[^>]*\/?>/);
  assert.match(writable, /aria-label="Selecionar pedido de Pessoa 1"[^>]*disabled/);
  assert.match(writable, /aria-label="Selecionar pedido de Pessoa 2"[^>]*disabled/);
  const readonly = render(false);
  assert.ok(!readonly.includes('type="checkbox"'));
  assert.ok(!readonly.includes('Enviar selecionados ao Omie'));
});
