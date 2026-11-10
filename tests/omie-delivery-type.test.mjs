import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadModule(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (!(name in modules)) throw new Error('Unexpected module: ' + name);
    return modules[name];
  }, exports);
  return exports;
}

const delivery = loadModule('../src/lib/omie/delivery-type.ts');
const mini = { nCodEntrega: 12345, nCodTransp: 67890, cCodIntEntrega: 'MINI', cDescricao: 'Mini Envios', cInativo: 'N' };
const page = (types = [mini], nPagina = 1, nTotalPaginas = 1) => ({ CadTiposEntrega: types, nPagina, nTotalPaginas });

test('resolve o código real de Mini Envios e a transportadora vinculada', async () => {
  const result = await delivery.resolveMiniEnvios(async () => page());
  assert.equal(result.nCodEntrega, 12345);
  assert.deepEqual(delivery.deliveryFreight(result), { codigo_tipo_entrega: 12345, codigo_transportadora: 67890 });
  assert.deepEqual(delivery.deliveryFreight({ ...result, nCodTransp: 0 }), { codigo_tipo_entrega: 12345 });
});

test('consulta todas as páginas e não seleciona serviços com nomes parecidos', async () => {
  const calls = [];
  const result = await delivery.resolveMiniEnvios(async params => {
    calls.push(params.nPagina);
    return params.nPagina === 1 ? page([{ ...mini, cDescricao: 'Mini Envios Express' }], 1, 2) : page([{ ...mini, cDescricao: 'Correios - Mini Envios' }], 2, 2);
  });
  assert.deepEqual(calls, [1, 2]); assert.equal(result.nCodEntrega, mini.nCodEntrega);
});

test('bloqueia serviço ausente, inativo, ambíguo e catálogo inválido', async () => {
  for (const types of [[], [{ ...mini, cInativo: 'S' }], [{ ...mini, cInativo: undefined }]]) {
    await assert.rejects(delivery.resolveMiniEnvios(async () => page(types)), /não foi encontrado/);
  }
  await assert.rejects(delivery.resolveMiniEnvios(async () => page([mini, { ...mini, nCodEntrega: 999 }])), /mais de um/);
  await assert.rejects(delivery.resolveMiniEnvios(async () => page([{ ...mini, nCodEntrega: 0 }])), /inválido/);
  await assert.rejects(delivery.resolveMiniEnvios(async () => page([{ ...mini, nCodTransp: -1 }])), /inválido/);
  await assert.rejects(delivery.resolveMiniEnvios(async () => ({ ...page(), nTotalPaginas: 999 })), /lista válida/);
  await assert.rejects(delivery.resolveMiniEnvios(async () => ({ ...page(), nPagina: 2 })), /lista válida/);
  await assert.rejects(delivery.resolveMiniEnvios(async () => { throw new Error('API indisponível'); }), /API indisponível/);
});

function orderActions({ types = [mini], role = 'operador', status = 'ready', catalogError = false } = {}) {
  const calls = [], writes = [], audits = [];
  const row = {
    id: '11111111-1111-4111-8111-111111111111', status,
    omie_customer_id: 2867720329, omie_tax_scenario_id: 2954399884,
    customer_purchase_order: null, customer_email: 'teste@example.com',
    recipients: { full_name: 'Motorista de teste', document_number: '00000000000', phone: '11000000000' },
    delivery_addresses: { street: 'Rua de Teste', number: '10', complement: 'Casa 2', district: 'Centro', city: 'Navegantes', state: 'SC', postal_code: '88370000', validation_status: 'pending' },
    fulfillment_items: [{ omie_product_id: 2948561716, product_code: 'R18', description: 'REMOTE BUTTON', ncm: '8517.62.99', cfop: '6.117', unit: 'PC', quantity: 1, unit_price: 107.97 }],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table) {
      let patch;
      const query = {
        select() { return query; }, eq() { return query; },
        update(value) { patch = value; writes.push(value); return query; },
        async maybeSingle() { return { data: table === 'user_profiles' ? { role, is_active: true } : patch ? { id: row.id } : row, error: null }; },
        async insert(value) { audits.push(value); return { error: null }; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return query;
    },
  };
  class ApiError extends Error {}
  const actions = loadModule('../src/app/pedidos/omie-actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => client },
    '@/lib/omie/delivery-type': delivery,
    '@/lib/omie/client': {
      OmieApiError: ApiError, OmieConfigurationError: ApiError,
      async callOmie(endpoint, method, params) {
        calls.push({ endpoint, method, params });
        if (method === 'ListarTipoEntrega') { if (catalogError) throw new ApiError('Catálogo indisponível'); return page(types); }
        if (method === 'IncluirPedido') return { codigo_pedido: 555, numero_pedido: '123' };
        throw new Error('Unexpected API method: ' + method);
      },
    },
  });
  return { actions, row, calls, writes, audits };
}

test('inclusão usa frete Mini Envios, mantém cenário e PO vazia e registra auditoria', async () => {
  const { actions, row, calls, writes, audits } = orderActions();
  const result = await actions.sendOrderToOmieAction(row.id);
  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map(call => call.method), ['ListarTipoEntrega', 'IncluirPedido']);
  assert.equal(calls[0].endpoint, '/geral/tiposentrega/');
  const payload = calls[1].params;
  assert.deepEqual(payload.frete, { codigo_tipo_entrega: 12345, codigo_transportadora: 67890 });
  assert.equal(payload.cabecalho.codigo_cenario_impostos, 2954399884);
  assert.equal(payload.cabecalho.codigo_cliente, 2867720329);
  assert.equal(payload.informacoes_adicionais.numero_pedido_cliente, '');
  assert.ok(!('numero_pedido_compra' in payload.det[0].inf_adic));
  assert.equal(payload.det[0].inf_adic.nao_movimentar_estoque, 'S');
  assert.equal(payload.det[0].inf_adic.nao_gerar_financeiro, 'S');
  assert.equal(writes[0].status, 'order_pending');
  assert.equal(audits[0].after_summary.delivery_type_id, 12345);
});

test('catálogo ausente ou indisponível bloqueia inclusão antes de alterar o pedido', async () => {
  for (const options of [{ types: [] }, { catalogError: true }]) {
    const { actions, row, calls, writes } = orderActions(options);
    const result = await actions.sendOrderToOmieAction(row.id);
    assert.equal(result.status, 'error'); assert.equal(writes.length, 0);
    assert.ok(!calls.some(call => call.method === 'IncluirPedido'));
  }
});

test('prévia apenas consulta o catálogo; perfil consulta não pode usá-la', async () => {
  const { actions, calls, writes } = orderActions();
  const result = await actions.previewMiniEnviosDeliveryAction();
  assert.equal(result.status, 'success'); assert.match(result.message, /12345/);
  assert.equal(calls.length, 1); assert.equal(writes.length, 0);
  const denied = orderActions({ role: 'consulta' });
  assert.equal((await denied.actions.previewMiniEnviosDeliveryAction()).status, 'error');
  assert.equal(denied.calls.length, 0);
});
