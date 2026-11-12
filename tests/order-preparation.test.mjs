import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';

function loadModule(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (!(name in modules)) throw new Error('Unexpected module: ' + name);
    return modules[name];
  }, exports);
  return exports;
}
const { defaultDeliveryAddress, runPreparationBatch } = loadModule('../src/lib/order-preparation.ts');
const reference = loadModule('../src/lib/omie/order-reference.ts');
const recipientId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';

test('seleciona endereço recente permitido, aceita pendente e ignora inválido mais novo', () => {
  const addresses = [
    { id: 'old', created_at: '2026-11-01', validation_status: 'valid' },
    { id: 'new', created_at: '2026-11-03', validation_status: 'invalid' },
    { id: 'pending', created_at: '2026-11-02', validation_status: 'pending' },
  ];
  assert.equal(defaultDeliveryAddress(addresses).id, 'pending');
  assert.equal(addresses[0].id, 'old');
  assert.equal(defaultDeliveryAddress([addresses[1]]), undefined);
});

test('prepara somente selecionados, sem concorrência, continua após falha e não repete seleção duplicada', async () => {
  const calls = [], results = [];
  let active = false;
  await runPreparationBatch(['first', 'failed', 'first', 'last'], {
    async prepare(id) {
      assert.equal(active, false); active = true;
      await Promise.resolve(); calls.push(id); active = false;
      if (id === 'failed') throw new Error('Conexão perdida');
      return { status: 'success', message: 'Preparado' };
    }, onResult(id, result) { results.push([id, result]); },
  });
  assert.deepEqual(calls, ['first', 'failed', 'last']);
  assert.equal(results[1][1].status, 'error');
  assert.match(results[1][1].message, /sem duplicar/);
  for (const ids of [[], Array.from({ length: 101 }, (_, i) => String(i))]) {
    await assert.rejects(runPreparationBatch(ids, { async prepare() { assert.fail('Lote inválido'); }, onResult() {} }));
  }
});

function actionsStub(options = {}) {
  const calls = [], filters = [];
  const client = {
    auth: { async getUser() { return { data: { user: options.loggedOut ? null : { id: 'user' } } }; } },
    from(table) {
      const query = {
        select() { return query; }, eq(name, value) { filters.push([name, value]); return query; },
        async maybeSingle() { return { data: table === 'user_profiles' ? { role: options.role ?? 'operador', is_active: options.active !== false } : options.existing ? { id: 'existing-order' } : null }; },
      };
      return query;
    },
    async rpc(method, params) { calls.push({ method, params }); return { data: 'new-order', error: options.duplicate ? { code: '23505', message: 'Duplicate' } : null }; },
  };
  const actions = loadModule('../src/app/pedidos/actions.ts', {
    'next/cache': { revalidatePath() {} }, '@/lib/supabase/server': { createSupabaseServerClient: async () => client },
    '@/lib/omie/order-reference': reference,
  });
  const form = new FormData();
  Object.entries({ recipient_id: recipientId, delivery_address_id: addressId, idempotency_key: key, customer_email: 'destinatario@example.com', quantity: '1', unit_price: '95.54', customer_purchase_order: '' }).forEach(([name, value]) => form.set(name, value));
  return { action: () => actions.prepareOrderAction({ status: 'idle', message: '' }, form), form, calls, filters };
}

test('cada preparação conserva destinatário/endereço/e-mail próprios e os parâmetros 1107, sem chamada Omie', async () => {
  const stub = actionsStub();
  assert.equal((await stub.action()).status, 'success');
  assert.deepEqual(stub.calls, [{ method: 'prepare_uber_fulfillment', params: {
    p_recipient_id: recipientId, p_delivery_address_id: addressId, p_idempotency_key: key,
    p_customer_purchase_order: null, p_customer_email: 'destinatario@example.com', p_quantity: 1, p_unit_price: 95.54,
  } }]);
});

test('reenvio da mesma chave confirma preparação anterior sem nova inclusão; conflito diferente não é sucesso', async () => {
  const retry = actionsStub({ duplicate: true, existing: true });
  assert.equal((await retry.action()).status, 'success');
  assert.deepEqual(retry.filters.slice(-4), [['idempotency_key', key], ['created_by', 'user'], ['recipient_id', recipientId], ['delivery_address_id', addressId]]);
  assert.equal(retry.calls.length, 1);
  assert.equal((await actionsStub({ duplicate: true }).action()).status, 'error');
});

test('servidor verifica sessão, perfil e dados antes de preparar mesmo em lote', async () => {
  for (const options of [{ loggedOut: true }, { role: 'consulta' }, { active: false }]) {
    const stub = actionsStub(options);
    assert.equal((await stub.action()).status, 'error'); assert.equal(stub.calls.length, 0);
  }
  for (const [name, value] of [['quantity', '2'], ['unit_price', '107.97'], ['recipient_id', 'invalid'], ['customer_email', 'inválido']]) {
    const stub = actionsStub(); stub.form.set(name, value);
    assert.equal((await stub.action()).status, 'error'); assert.equal(stub.calls.length, 0);
  }
});

test('janela exibe vários destinatários com endereço e e-mail individuais sem criar pedidos na abertura', () => {
  const { OrderBatchModal } = loadModule('../src/app/pedidos/order-batch-modal.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
    './actions': { prepareOrderAction() { assert.fail('Abrir janela não deve criar pedidos'); } },
    '@/lib/omie/order-reference': reference,
    '@/lib/order-preparation': { defaultDeliveryAddress, runPreparationBatch },
  });
  const html = renderToStaticMarkup(React.createElement(OrderBatchModal, {
    recipients: [
      { id: recipientId, full_name: 'Destinatário A', email: 'a@example.com', delivery_addresses: [
        { id: addressId, street: 'Rua A', number: '1', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ', postal_code: '20000000', created_at: '2026-11-11', validation_status: 'pending' },
      ] },
      { id: 'other', full_name: 'Destinatário B', email: 'b@example.com', delivery_addresses: [] },
    ], onClose() {}, onSaved() {},
  }));
  assert.match(html, /Selecionar Destinatário A/);
  assert.match(html, /Selecionar Destinatário B/);
  assert.match(html, /a@example.com/);
  assert.match(html, /b@example.com/);
  assert.match(html, /Rua A/);
  assert.match(html, /Cadastre um endereço/);
  assert.match(html, /Preparar 0 pedido/);
});

test('destinatário preparado sai da seleção do lote, mas falhas continuam disponíveis para repetir', () => {
  let stateIndex = 0;
  const { OrderBatchModal } = loadModule('../src/app/pedidos/order-batch-modal.tsx', {
    react: { ...React, useState(initial) {
      const state = React.useState(initial);
      const index = stateIndex++;
      if (index === 2) return [[recipientId, 'failed'], () => {}];
      if (index === 4) return [{
        [recipientId]: { status: 'success', message: 'Preparado' },
        failed: { status: 'error', message: 'Falha temporária' },
      }, () => {}];
      return state;
    } },
    'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
    './actions': { prepareOrderAction() { assert.fail('Renderizar não deve criar pedidos'); } },
    '@/lib/omie/order-reference': reference,
    '@/lib/order-preparation': { defaultDeliveryAddress, runPreparationBatch },
  });
  const html = renderToStaticMarkup(React.createElement(OrderBatchModal, {
    recipients: [
      { id: recipientId, full_name: 'Já preparado', email: 'a@example.com', delivery_addresses: [] },
      { id: 'failed', full_name: 'Tentar novamente', email: 'b@example.com', delivery_addresses: [] },
    ], onClose() {}, onSaved() {},
  }));
  assert.doesNotMatch(html, /Selecionar Já preparado/);
  assert.match(html, /Selecionar Tentar novamente/);
  assert.match(html, /Falha temporária/);
  assert.match(html, /1 preparado/);
  assert.match(html, /Preparar 1 pedido/);
});
