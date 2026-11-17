import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path, modules) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in modules, 'Unexpected module: ' + name);
    return modules[name];
  }, exports);
  return exports;
}
function setup(options = {}) {
  const calls = [];
  const row = { status: 'order_pending', omie_order_id: null, updated_at: '2026-11-17T12:00:00Z',
    delivery_recipient_name: 'Nome corrigido', customer_email: 'pedido@example.com', omie_last_error: 'Nome longo',
    recipients: { full_name: 'Nome original', email: 'cadastro@example.com' },
    delivery_addresses: { postal_code: '23088000', street: 'Estrada da Posse', number: '1', complement: null, district: 'Campo Grande', city: 'Rio de Janeiro', state: 'RJ' }, ...options.row };
  const client = {
    auth: { async getUser() { return { data: { user: options.loggedOut ? null : { id: 'actor' } } }; } },
    from(table) {
      const q = { select() { return q; }, eq() { return q; }, async maybeSingle() {
        return { data: table === 'user_profiles' ? { role: options.role ?? 'operador', is_active: options.active !== false } : row };
      } }; return q;
    },
    async rpc(name, params) { calls.push({ name, params }); return { error: options.error ? { message: options.error } : null }; },
  };
  const actions = load('../src/app/pedidos/review-actions.ts', {
    'next/cache': { revalidatePath() {} }, '@/lib/supabase/server': { createSupabaseServerClient: async () => client },
  });
  return { actions, calls };
}
test('revisão carrega os dados efetivos do pedido sem substituir pelo cadastro original', async () => {
  const { actions, calls } = setup();
  const result = await actions.loadReviewOrderAction('order');
  assert.equal(result.data.name, 'Nome corrigido');
  assert.equal(result.data.email, 'pedido@example.com');
  assert.equal(result.data.complement, '');
  assert.equal(result.data.lastError, 'Nome longo');
  assert.equal(calls.length, 0);
});
test('revisão bloqueia perfis sem escrita, sessões expiradas e pedidos já vinculados', async () => {
  for (const option of [{ loggedOut: true }, { role: 'consulta' }, { active: false }, { row: { omie_order_id: 123 } }, { row: { status: 'cancelled' } }, { row: { status: 'ready' } }]) {
    const { actions, calls } = setup(option);
    assert.equal((await actions.loadReviewOrderAction('order')).status, 'error');
    assert.equal(calls.length, 0);
  }
});
test('salvar usa RPC transacional com versão esperada e não chama integração Omie', async () => {
  const { actions, calls } = setup();
  const fields = { name: 'Nome novo', city: 'Magé' };
  const result = await actions.saveReviewOrderAction('order', 'version', fields);
  assert.equal(result.status, 'success');
  assert.deepEqual(calls, [{ name: 'save_reviewed_fulfillment', params: { p_id: 'order', p_expected_updated_at: 'version', p_fields: fields } }]);
  assert.match(result.message, /Enviar ao Omie/);
});
test('salvar não permite contornar permissões e explica conflitos de edição e envio', async () => {
  for (const option of [{ loggedOut: true }, { role: 'consulta' }, { active: false }]) {
    const { actions, calls } = setup(option);
    assert.equal((await actions.saveReviewOrderAction('order', 'version', {})).status, 'error');
    assert.equal(calls.length, 0);
  }
  for (const [error, pattern] of [['ORDER_CHANGED', /mudou/], ['SEND_IN_PROGRESS', /andamento/], ['NOT_REVIEWABLE', /situação/], ['INVALID_REVIEW_FIELDS', /60 caracteres/]]) {
    const { actions } = setup({ error });
    const result = await actions.saveReviewOrderAction('order', 'version', {});
    assert.equal(result.status, 'error'); assert.match(result.message, pattern);
  }
});
