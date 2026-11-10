import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadModule(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (!(name in modules)) throw new Error('Unexpected module: ' + name);
    return modules[name];
  }, exports);
  return exports;
}

const freight = loadModule('../src/lib/omie/freight-selection.ts');
const id = '11111111-1111-4111-8111-111111111111';
const integrationCode = 'UFB-' + id.replaceAll('-', '');
const mini = { nIdFrete: 987, cTipoServico: '03298', cDescricaoServico: 'Mini Envios', cNomeTransportadora: 'CORREIOS', nDiasEntrega: 5, nValorFrete: 12.5 };

function omieStub(options = {}) {
  const calls = [];
  let reads = 0;
  let carrierAssigned = false;
  const request = async (endpoint, method, params) => {
    calls.push({ endpoint, method, params });
    if (method === 'ConsultarPedido') {
      reads++;
      if (options.afterError && reads === 3) throw new Error('Falha de consulta');
      return { pedido_venda_produto: {
        cabecalho: { codigo_pedido: 555, codigo_pedido_integracao: options.wrongLink ? 'outro' : integrationCode },
        infoCadastro: { cancelado: options.cancelled ? 'S' : 'N', faturado: options.invoiced ? 'S' : 'N' },
        frete: { codigo_transportadora: options.noCarrier && (!carrierAssigned || options.assignmentFailure) ? 0 : options.changedCarrier && reads >= 2 ? 999 : 123,
          valor_frete: options.notFree && reads === 3 ? 12.5 : 0, quantidade_volumes: 1, modalidade: '9' },
      } };
    }
    if (method === 'ConsultarCliente') return { codigo_cliente_omie: 123, razao_social: options.otherCarrier ? 'Transportadora diferente' : 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS' };
    if (method === 'ListarClientes') return { pagina: 1, total_de_paginas: 1, clientes_cadastro: options.carriers ?? [{ codigo_cliente_omie: 123, razao_social: 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS', inativo: 'N' }] };
    if (method === 'AlterarPedidoVenda') { carrierAssigned = true; return {}; }
    if (method === 'StatusPedido') return { codigo_pedido: 555, numero_pedido: '1128', etapa: '10' };
    if (method === 'CotarFrete') return options.quoteResponse ?? { listaCotacao: options.quotes ?? [mini] };
    if (method === 'SelecionarFrete') { if (options.selectTimeout) throw new Error('Timeout'); return options.selectResponse ?? {}; }
    if (method === 'IncluirPedido') return { codigo_pedido: 555, numero_pedido: '1128' };
    throw new Error('Método não autorizado no teste: ' + method);
  };
  return { request, calls };
}

test('cota e seleciona o nIdFrete Mini Envios com lGratis true, sem gerar frete ou etiqueta', async () => {
  const { request, calls } = omieStub();
  const result = await freight.selectMiniEnviosFreight(request, 555, integrationCode);
  assert.equal(result.quote.nIdFrete, 987); assert.equal(result.freeForCustomer, true);
  assert.deepEqual(calls.map(call => call.method), ['ConsultarPedido', 'ConsultarCliente', 'CotarFrete', 'ConsultarPedido', 'SelecionarFrete', 'ConsultarPedido']);
  assert.deepEqual(calls[2].params, { nIdPedido: 555 });
  assert.deepEqual(calls[4].params, { nIdFrete: 987, lGratis: true });
  assert.equal(calls[4].endpoint, '/produtos/frete/');
  assert.ok(!calls.some(call => ['GerarFrete', 'GerarEtiqueta', 'FaturarPedidoVenda', 'VincularFrete'].includes(call.method)));
});

test('não seleciona quando vínculo, situação, transportadora ou cotação são inválidos', async () => {
  for (const options of [
    { wrongLink: true }, { cancelled: true }, { invoiced: true }, { noCarrier: true, assignmentFailure: true }, { otherCarrier: true }, { changedCarrier: true },
    { quotes: [] }, { quotes: [mini, { ...mini, nIdFrete: 988 }] },
    { quotes: [{ ...mini, cDescricaoServico: 'SEDEX' }] }, { quotes: [{ ...mini, nIdFrete: 0 }] },
    { quotes: [{ ...mini, cNomeTransportadora: 'Outra transportadora' }] },
    { quoteResponse: { cCodStatus: '100', cDesStatus: 'Nenhuma cotação disponível' } },
  ]) {
    const { request, calls } = omieStub(options);
    await assert.rejects(freight.selectMiniEnviosFreight(request, 555, integrationCode));
    assert.ok(!calls.some(call => call.method === 'SelecionarFrete'));
  }
});

test('timeout na seleção não é repetido e retorna resultado desconhecido', async () => {
  const { request, calls } = omieStub({ selectTimeout: true });
  await assert.rejects(freight.selectMiniEnviosFreight(request, 555, integrationCode), error => error.outcome === 'unknown');
  assert.equal(calls.filter(call => call.method === 'SelecionarFrete').length, 1);
});

test('distingue rejeição de seleção aceita com falha na conferência posterior', async () => {
  const rejected = omieStub({ selectResponse: { cCodStatus: '100', cDesStatus: 'Cotação expirada' } });
  await assert.rejects(freight.selectMiniEnviosFreight(rejected.request, 555, integrationCode), error => error.outcome === 'not_selected');
  for (const options of [{ afterError: true }, { notFree: true }]) {
    const { request } = omieStub(options);
    await assert.rejects(freight.selectMiniEnviosFreight(request, 555, integrationCode), error => error.outcome === 'selected');
  }
});

function actionsStub(options = {}) {
  const omie = omieStub(options);
  const writes = [], audits = [], shipments = [];
  const row = {
    id, status: options.status ?? 'ready', omie_order_id: options.status ? 555 : null,
    omie_last_error: options.freightError ?? null,
    omie_customer_id: 2867720329, omie_tax_scenario_id: 2954399884,
    customer_purchase_order: null, customer_email: 'teste@example.com',
    recipients: { full_name: 'Teste', document_number: '00000000000', phone: '11000000000' },
    delivery_addresses: { street: 'Rua Teste', number: '1', district: 'Centro', city: 'Navegantes', state: 'SC', postal_code: '88370000', validation_status: 'pending' },
    fulfillment_items: [{ omie_product_id: 2948561716, product_code: 'R18', description: 'REMOTE BUTTON', ncm: '8517.62.99', cfop: '6.117', unit: 'PC', quantity: 1, unit_price: 107.97 }],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table) {
      let patch;
      const query = {
        select() { return query; }, eq() { return query; },
        update(value) { patch = value; writes.push(value); return query; },
        async maybeSingle() { return { data: table === 'user_profiles' ? { role: options.role ?? 'operador', is_active: true } : patch ? { id } : row, error: null }; },
        async insert(value) { audits.push(value); return { error: null }; },
        async upsert(value) { shipments.push(value); return { error: options.localFailure ? { message: 'Falha local' } : null }; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return query;
    },
  };
  class ApiError extends Error {}
  const actions = loadModule('../src/app/pedidos/omie-actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => client },
    '@/lib/omie/freight-selection': freight,
    '@/lib/omie/client': { callOmie: omie.request, OmieApiError: ApiError, OmieConfigurationError: ApiError },
  });
  return { actions, writes, audits, shipments, calls: omie.calls };
}

test('criação mantém PO e cenário e depois seleciona a opção de frete cotada', async () => {
  const { actions, calls, audits, shipments } = actionsStub();
  const result = await actions.sendOrderToOmieAction(id);
  assert.equal(result.status, 'success');
  assert.equal(calls[0].method, 'ListarClientes');
  const payload = calls.find(call => call.method === 'IncluirPedido').params;
  assert.equal(payload.cabecalho.codigo_cenario_impostos, 2954399884);
  assert.deepEqual(payload.frete, { codigo_transportadora: 123 }); assert.ok(!('numero_pedido_compra' in payload.det[0].inf_adic));
  assert.equal(audits[1].action, 'omie.freight.selected'); assert.equal(audits[1].after_summary.freight_quote_id, 987);
  assert.equal(shipments[0].freight_amount, 0);
});

test('falha de frete mantém pedido criado e não retorna para pendente de inclusão', async () => {
  for (const options of [{ quotes: [] }, { selectTimeout: true }, { localFailure: true }]) {
    const { actions, calls, writes } = actionsStub(options);
    const result = await actions.sendOrderToOmieAction(id);
    assert.equal(result.status, 'warning'); assert.match(result.message, /Pedido criado no Omie/);
    assert.deepEqual(writes.map(write => write.status).filter(Boolean), ['order_pending', 'order_created']);
    assert.ok(writes.some(write => typeof write.omie_last_error === 'string'));
    assert.equal(calls.filter(call => call.method === 'IncluirPedido').length, 1);
  }
});

test('ação de frete em pedido existente não inclui novo pedido e respeita perfil e status', async () => {
  const existing = actionsStub({ status: 'order_created' });
  assert.equal((await existing.actions.selectMiniEnviosFreightAction(id)).status, 'success');
  assert.ok(!existing.calls.some(call => call.method === 'IncluirPedido'));
  for (const options of [{ status: 'billed' }, { status: 'order_created', role: 'consulta' }]) {
    const denied = actionsStub(options);
    assert.notEqual((await denied.actions.selectMiniEnviosFreightAction(id)).status, 'success');
    assert.equal(denied.calls.length, 0);
  }
});

test('pedido existente sem transportadora recebe Correios e depois seleciona Mini Envios', async () => {
  const { request, calls } = omieStub({ noCarrier: true });
  const result = await freight.selectMiniEnviosFreight(request, 555, integrationCode);
  assert.equal(result.carrierId, 123);
  const update = calls.find(call => call.method === 'AlterarPedidoVenda');
  assert.deepEqual(update.params, { cabecalho: { codigo_pedido: 555, codigo_pedido_integracao: integrationCode }, frete: { codigo_transportadora: 123 } });
  assert.ok(calls.findIndex(call => call.method === 'AlterarPedidoVenda') < calls.findIndex(call => call.method === 'CotarFrete'));
});

test('cadastro Correios ausente, inativo ou ambíguo bloqueia a criação antes de reservar', async () => {
  const carrier = { codigo_cliente_omie: 123, razao_social: 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS', inativo: 'N' };
  for (const carriers of [[], [{ ...carrier, inativo: 'S' }], [carrier, { ...carrier, codigo_cliente_omie: 456 }]]) {
    const { actions, calls, writes } = actionsStub({ carriers });
    assert.equal((await actions.sendOrderToOmieAction(id)).status, 'error');
    assert.ok(!calls.some(call => call.method === 'IncluirPedido'));
    assert.equal(writes.length, 0);
  }
});

test('sincronizar pedido preserva o erro de frete e auditoria guarda o motivo de falha', async () => {
  const message = 'Frete: Mini Envios indisponível';
  const synced = actionsStub({ status: 'order_created', freightError: message });
  assert.equal((await synced.actions.syncOmieOrderAction(id)).status, 'success');
  assert.equal(synced.writes[0].omie_last_error, message);
  const pending = actionsStub({ status: 'order_created', quotes: [] });
  await pending.actions.selectMiniEnviosFreightAction(id);
  assert.match(pending.audits[0].after_summary.message, /Mini Envios não está disponível/);
  assert.match(pending.writes[0].omie_last_error, /^Frete: /);
});
