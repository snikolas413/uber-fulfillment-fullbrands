import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in modules, name); return modules[name];
  }, exports);
  return exports;
}
const inspect = load('../src/lib/omie/manual-freight.ts');
const id = '11111111-1111-4111-8111-111111111111';
const integration = 'UFB-' + id.replaceAll('-', '');
const order = () => ({ cabecalho: { codigo_pedido: 123, codigo_pedido_integracao: integration, etapa: '50', bloqueado: 'N' },
  infoCadastro: { cancelado: 'N', faturado: 'N' }, frete: { codigo_transportadora: 2757271756, quantidade_volumes: 1,
    modalidade: '0', previsao_entrega: '27/11/2026' } });

test('liberação manual exige vínculo, frete grátis, remetente, volumes e previsão válidos', () => {
  assert.equal(inspect.inspectManualFreight(order(), 123, integration).freight_amount, 0);
  for (const change of [
    o => { o.cabecalho.codigo_pedido = 124; }, o => { o.cabecalho.codigo_pedido_integracao = 'outro'; },
    o => { o.infoCadastro.faturado = 'S'; }, o => { o.infoCadastro.cancelado = 'S'; },
    o => { o.cabecalho.bloqueado = 'S'; }, o => { o.cabecalho.etapa = '60'; },
    o => { o.frete.codigo_transportadora = 1; }, o => { o.frete.valor_frete = 15.99; },
    o => { o.frete.valor_frete = null; }, o => { o.frete.valor_seguro = 1; },
    o => { o.frete.outras_despesas = 1; }, o => { o.frete.modalidade = '9'; },
    o => { delete o.frete.quantidade_volumes; }, o => { o.frete.quantidade_volumes = 21; },
    o => { o.frete.previsao_entrega = '31/02/2026'; }, o => { delete o.frete.previsao_entrega; },
  ]) { const o = order(); change(o); assert.throws(() => inspect.inspectManualFreight(o, 123, integration)); }
});

function harness(options = {}) {
  const requests = [], rpcs = [], invalidations = [];
  const db = {
    auth: { async getUser() { return { data: { user: options.loggedOut ? null : { id: 'operator' } } }; } },
    from(table) { return { select() { return this; }, eq() { return this; }, async maybeSingle() {
      return { data: table === 'user_profiles' ? { role: options.role ?? 'operador', is_active: !options.inactive } :
        { id, status: options.status ?? 'order_created', updated_at: '2026-11-19T12:00:00Z', omie_order_id: 123 } };
    } }; },
    async rpc(name, params) { rpcs.push([name, params]); return { error: options.saveError ? { message: 'INVOICE_REGISTERED' } : null }; },
  };
  const actions = load('../src/app/pedidos/manual-freight-actions.ts', {
    'next/cache': { revalidatePath: path => invalidations.push(path) },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => db },
    '@/lib/omie/manual-freight': inspect,
    '@/lib/omie/client': { async callOmie(endpoint, method) {
      requests.push(method);
      if (method === 'ConsultarPedido') { const o = order(); if (options.paid) o.frete.valor_frete = 15.99; return { pedido_venda_produto: o }; }
      assert.equal(method, 'ValidarPedidoVenda');
      return { cCodStatus: options.rejected ? '100' : '0', cDescStatus: 'Recusa fiscal' };
    } },
  });
  return { ...actions, requests, rpcs, invalidations };
}
test('ação só consulta e valida no Omie; salva confirmação e invalida telas, sem emitir ou gerar frete', async () => {
  const h = harness();
  assert.equal((await h.confirmManualFreightAction(id, true)).status, 'success');
  assert.deepEqual(h.requests, ['ConsultarPedido', 'ValidarPedidoVenda']);
  assert.equal(h.rpcs.length, 1);
  assert.equal(h.rpcs[0][0], 'confirm_manual_freight');
  assert.equal(h.rpcs[0][1].p_confirmed, true);
  assert.equal(h.rpcs[0][1].p_freight.service_code, 'Mini Envios');
  assert.deepEqual(h.invalidations, ['/faturamento', '/pedidos', '/expedicao']);
});
test('sem confirmação, sessão ou perfil de operação não consulta; divergências não liberam', async () => {
  const initial = harness();
  assert.equal((await initial.confirmManualFreightAction(id, false)).status, 'error');
  assert.deepEqual(initial.requests, []);
  for (const options of [{ loggedOut: true }, { role: 'consulta' }, { inactive: true }, { status: 'billed' }]) {
    const h = harness(options);
    assert.equal((await h.confirmManualFreightAction(id, true)).status, 'error');
    assert.deepEqual(h.requests, []); assert.deepEqual(h.rpcs, []);
  }
  for (const options of [{ paid: true }, { rejected: true }, { saveError: true }]) {
    const h = harness(options);
    assert.equal((await h.confirmManualFreightAction(id, true)).status, 'error');
    assert.equal(h.rpcs.length, options.saveError ? 1 : 0);
  }
});
