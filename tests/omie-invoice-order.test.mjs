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
const itemIcms = loadModule('../src/lib/omie/item-icms.ts');
const billing = loadModule('../src/lib/omie/invoice-order.ts', { '@/lib/omie/item-icms': itemIcms });
const freight = loadModule('../src/lib/omie/freight-selection.ts');
const id = '11111111-1111-4111-8111-111111111111';
const integrationCode = 'UFB-' + id.replaceAll('-', '');

function omie(options = {}) {
  const calls = [], states = [];
  let requested = false, locked = false, refreshed = false;
  const snapshot = () => ({ codigo_pedido: 555, codigo_pedido_integracao: integrationCode, numero_pedido: '1140', etapa: '50',
    faturada: options.alreadyBilled || (requested && !options.delayed) ? 'S' : 'N',
    ListaNfe: options.alreadyBilled || (requested && !options.delayed) ? [{ numero_nfe: '123', chave_nfe: 'chave-teste' }] : [], ...options.status });
  const request = async (endpoint, method, params) => {
    calls.push({ endpoint, method, params });
    if (method === 'ConsultarPedido') return { pedido_venda_produto: {
      cabecalho: { codigo_pedido: options.wrongOrder ? 999 : 555, codigo_pedido_integracao: integrationCode, codigo_cenario_impostos: '777', codigo_cliente: 888, etapa: options.stage ?? '10', bloqueado: options.blocked ? 'S' : 'N' },
      infoCadastro: { faturado: options.alreadyBilled ? 'S' : 'N', cancelado: options.cancelled ? 'S' : 'N' },
      frete: { codigo_transportadora: options.changedCarrier ? 999 : 123, ...(options.omitFreight ? {} : { valor_frete: options.notFree ? 12 : 0 }) },
      informacoes_adicionais: { consumidor_final: 'S', outros_detalhes: { cEstadoOd: 'SC', cEnderecoOd: 'Rua Teste' } },
      det: [{ ide: { codigo_item: 1234, codigo_item_integracao: 'item-teste', simples_nacional: options.simples ? 'S' : 'N' },
        produto: { codigo_produto: 987, codigo: 'R18', quantidade: 1, valor_unitario: refreshed && options.changedPrice ? 99 : 107.97, valor_total: 122.01 },
        inf_adic: { codigo_cenario_impostos_item: '777', nao_gerar_financeiro: 'S', nao_movimentar_estoque: 'S' },
        imposto: options.missingIcms && (!refreshed || options.stillMissing) ? {} : options.simples ? { icms_sn: { cod_sit_trib_icms_sn: '102', origem_icms_sn: '1', aliq_icms_sn: 0 } } : {
          icms: { cod_sit_trib_icms: '00', origem_icms: '1', modalidade_icms: '3', perc_red_base_icms: 0, aliq_icms: 4, base_icms: options.noBase ? 0 : 126.03, valor_icms: 5.04 },
        },
      }],
    } };
    if (method === 'ConsultarProduto') return { codigo_produto: params.codigo_produto, recomendacoes_fiscais: { origem_mercadoria: '1' } };
    if (method === 'ListarImpostosCenario') return { ...params, impostos: { cst_icms: '00', modalidade_bc_icms: '3', reducao_bc_icms: 0, aliquota_icms: 4, perc_fcp_icms: 0, csosn: '102', aliquota_icms_simples: 0 } };
    if (method === 'AlterarPedidoVenda') { refreshed = true; return { codigo_status: options.refreshError ? '1' : '0', descricao_status: 'Atualização fiscal recusada' }; }
    if (method === 'TrocarEtapaPedido') return { codigo_status: options.stageError ? '1' : '0', descricao_status: 'Etapa não liberada' };
    if (method === 'StatusPedido') {
      if (requested && options.afterReadError) throw new Error('Consulta indisponível');
      return snapshot();
    }
    if (method === 'ValidarPedidoVenda') return { cCodStatus: options.validationError ? '1' : '0', cDescStatus: 'Dados fiscais incompletos' };
    if (method === 'FaturarPedidoVenda') {
      requested = true;
      if (options.timeout) throw new Error('Tempo de resposta esgotado');
      return options.invoiceResponse ?? { cCodStatus: '0' };
    }
    throw new Error('Método inesperado: ' + method);
  };
  const claim = async () => { if (locked || options.claimDenied) return false; locked = true; return true; };
  const settle = async state => { states.push(state); };
  const args = { request, orderId: 555, integrationCode, carrierId: 123, claim, settle };
  return { args, calls, states };
}

test('fatura pedido existente com contrato correto, validação e conferência, sem criar pedido ou mudar cenário', async () => {
  const { args, calls, states } = omie({ omitFreight: true });
  const result = await billing.invoiceExistingOrder(args);
  assert.equal(result.outcome, 'confirmed');
  assert.equal(result.snapshot.ListaNfe[0].numero_nfe, '123');
  assert.deepEqual(calls.map(call => call.method), ['ConsultarPedido', 'TrocarEtapaPedido', 'StatusPedido', 'ValidarPedidoVenda', 'FaturarPedidoVenda', 'StatusPedido']);
  const params = { nCodPed: 555, cCodIntPed: integrationCode };
  assert.deepEqual(calls.find(call => call.method === 'ValidarPedidoVenda').params, params);
  assert.deepEqual(calls.find(call => call.method === 'FaturarPedidoVenda').params, params);
  assert.deepEqual(calls.find(call => call.method === 'TrocarEtapaPedido').params, { codigo_pedido: 555, codigo_pedido_integracao: integrationCode, etapa: '50' });
  assert.deepEqual(states, ['billing_submitted']);
  assert.ok(!calls.some(call => ['IncluirPedido', 'AlterarPedidoVenda', 'GerarEtiqueta'].includes(call.method)));
});

test('não muda etapa já preparada nem reemite pedido já faturado', async () => {
  const prepared = omie({ stage: '50' });
  assert.equal((await billing.invoiceExistingOrder(prepared.args)).outcome, 'confirmed');
  assert.ok(!prepared.calls.some(call => call.method === 'TrocarEtapaPedido'));
  const billed = omie({ alreadyBilled: true });
  assert.equal((await billing.invoiceExistingOrder(billed.args)).outcome, 'confirmed');
  assert.deepEqual(billed.calls.map(call => call.method), ['ConsultarPedido', 'StatusPedido']);
});

test('ICMS ausente reaplica o cenário já escolhido, preservando dados e endereços sem fixar CST', async () => {
  for (const simples of [false, true]) {
    const { args, calls } = omie({ missingIcms: true, simples });
    const result = await billing.invoiceExistingOrder(args);
    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.taxScenarioRefreshRequested, true);
    const refresh = calls.find(call => call.method === 'AlterarPedidoVenda');
    assert.deepEqual(refresh.params, { cabecalho: { codigo_pedido: 555, codigo_pedido_integracao: integrationCode }, det: [{
      ide: { codigo_item: 1234, codigo_item_integracao: 'item-teste' },
      produto: { codigo_produto: 987, quantidade: 1, valor_unitario: 107.97, codigo: 'R18' },
      inf_adic: { codigo_cenario_impostos_item: 777, nao_gerar_financeiro: 'S', nao_movimentar_estoque: 'S' },
      imposto: simples ? { icms_sn: { cod_sit_trib_icms_sn: '102', origem_icms_sn: '1', aliq_icms_sn: 0 } } : {
        icms: { cod_sit_trib_icms: '00', origem_icms: '1', modalidade_icms: '3', perc_red_base_icms: 0, aliq_icms: 4, perc_fcp_icms: 0 },
      },
    }] });
    assert.ok(!('base_icms' in (refresh.params.det[0].imposto.icms ?? {})));
    assert.ok(!('informacoes_adicionais' in refresh.params));
    assert.equal(calls.filter(call => call.method === 'AlterarPedidoVenda').length, 1);
    assert.ok(calls.findIndex(call => call.method === 'AlterarPedidoVenda') < calls.findIndex(call => call.method === 'ValidarPedidoVenda'));
  }
});

test('atualização fiscal sem CST, recusada ou com mudança de preço não solicita faturamento', async () => {
  for (const options of [{ stillMissing: true }, { refreshError: true }, { changedPrice: true }, { noBase: true }]) {
    const { args, calls, states } = omie({ missingIcms: true, ...options });
    const result = await billing.invoiceExistingOrder(args);
    assert.equal(result.outcome, 'rejected');
    if (options.stillMissing || options.noBase) assert.match(result.message, /não confirmou os campos e o cálculo de ICMS.*777/);
    assert.ok(!calls.some(call => ['ValidarPedidoVenda', 'FaturarPedidoVenda'].includes(call.method)));
    assert.deepEqual(states, ['billing_rejected']);
  }
});

test('bloqueia cancelamento, vínculo, frete, etapa, status fiscal e validação inválidos antes da emissão', async () => {
  for (const options of [{ wrongOrder: true }, { cancelled: true }, { blocked: true }, { changedCarrier: true }, { notFree: true },
    { stage: '70' }, { stageError: true }, { validationError: true }, { status: { etapa: '10' } }, { status: { codigo_pedido_integracao: 'outro' } }]) {
    const { args, calls } = omie(options);
    assert.equal((await billing.invoiceExistingOrder(args)).outcome, 'rejected');
    assert.ok(!calls.some(call => call.method === 'FaturarPedidoVenda'));
  }
});

test('reserva exclusiva permite somente uma emissão em tentativas concorrentes', async () => {
  const { args, calls } = omie();
  const results = await Promise.all([billing.invoiceExistingOrder(args), billing.invoiceExistingOrder(args)]);
  assert.deepEqual(results.map(result => result.outcome).sort(), ['blocked', 'confirmed']);
  assert.equal(calls.filter(call => call.method === 'FaturarPedidoVenda').length, 1);
});

test('timeout, recusa ou resposta incompleta na emissão ficam sem confirmação e não são repetidos', async () => {
  for (const options of [{ timeout: true }, { invoiceResponse: {} }, { invoiceResponse: { cCodStatus: '100', cDescStatus: 'Em processamento' } }]) {
    const { args, calls, states } = omie(options);
    assert.equal((await billing.invoiceExistingOrder(args)).outcome, 'unknown');
    assert.deepEqual(states, ['billing_unknown']);
    assert.equal(calls.filter(call => call.method === 'FaturarPedidoVenda').length, 1);
  }
});

test('aceite com nota pendente ou falha posterior é submetido, sem declarar NF-e confirmada', async () => {
  for (const options of [{ delayed: true }, { afterReadError: true }]) {
    const { args, calls, states } = omie(options);
    const result = await billing.invoiceExistingOrder(args);
    assert.equal(result.outcome, 'submitted');
    assert.ok(states.every(state => state === 'billing_submitted'));
    assert.equal(calls.filter(call => call.method === 'FaturarPedidoVenda').length, 1);
  }
});

function actionHarness(options = {}) {
  const upstream = omie(options);
  const invoice = options.invoice ? { id: 'invoice-1', ...options.invoice } : null;
  const records = { invoice, audits: [], writes: [], authReads: 0 };
  const row = { id, status: 'order_created', omie_order_id: 555, omie_order_number: '1140', omie_last_error: options.freightError ? 'Frete: Pendente' : null };
  const client = {
    auth: { async getUser() { records.authReads++; return { data: { user: options.loggedOut ? null : { id: 'user' } }, error: null }; } },
    from(table) {
      let mode = 'select', patch = {}, conditions = [];
      const query = {
        select() { return query; }, eq(field, value) { conditions.push([field, value]); return query; },
        is(field, value) { conditions.push([field, value]); return query; }, in(field, values) { conditions.push([field, values]); return query; },
        insert(value) { mode = 'insert'; patch = value; return query; }, update(value) { mode = 'update'; patch = value; return query; },
        upsert(value) { mode = 'upsert'; patch = value; return query; },
        async maybeSingle() {
          if (table === 'user_profiles') return { data: { role: options.role ?? 'operador', is_active: !options.inactive }, error: null };
          if (table === 'fulfillments') return { data: row, error: null };
          if (table === 'shipments') return { data: options.noShipment ? null : { carrier_id: '123', service_code: '04227', freight_amount: 0 }, error: null };
          if (table === 'invoices' && mode === 'insert') {
            if (records.invoice) return { data: null, error: { code: '23505' } };
            records.invoice = { id: 'invoice-1', ...patch, omie_invoice_number: null, access_key: null };
            return { data: { id: 'invoice-1' }, error: null };
          }
          if (table === 'invoices' && mode === 'update') {
            const matches = records.invoice && conditions.every(([field, value]) => Array.isArray(value) ? value.includes(records.invoice[field]) : records.invoice[field] === value);
            if (matches) Object.assign(records.invoice, patch);
            return { data: matches ? { id: records.invoice.id } : null, error: null };
          }
          throw new Error('Consulta não esperada: ' + table);
        },
        then(resolve) {
          if (table === 'audit_logs') records.audits.push(patch);
          else if (table === 'invoices' && mode === 'update') {
            const matches = records.invoice && conditions.every(([field, value]) => Array.isArray(value) ? value.includes(records.invoice[field]) : records.invoice[field] === value);
            if (matches) Object.assign(records.invoice, patch);
          } else if (table === 'invoices' && mode === 'upsert') records.invoice = { ...records.invoice, ...patch };
          else if (table === 'fulfillments') { records.writes.push(patch); Object.assign(row, patch); }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  class ApiError extends Error {}
  const actions = loadModule('../src/app/pedidos/omie-actions.ts', {
    'next/cache': { revalidatePath() {} }, '@/lib/supabase/server': { createSupabaseServerClient: async () => client },
    '@/lib/omie/freight-selection': freight, '@/lib/omie/invoice-order': billing,
    '@/lib/omie/item-icms': itemIcms,
    '@/lib/omie/client': { callOmie: upstream.args.request, OmieApiError: ApiError, OmieConfigurationError: ApiError },
  });
  return { actions, records, calls: upstream.calls };
}

test('ação exige confirmação, sessão, perfil ativo e frete confirmado no servidor', async () => {
  const unconfirmed = actionHarness();
  assert.equal((await unconfirmed.actions.invoiceOrderAction(id)).status, 'error');
  assert.equal(unconfirmed.records.authReads, 0);
  for (const options of [{ loggedOut: true }, { role: 'consulta' }, { inactive: true }, { noShipment: true }, { freightError: true }]) {
    const harness = actionHarness(options);
    assert.notEqual((await harness.actions.invoiceOrderAction(id, true)).status, 'success');
    assert.equal(harness.calls.length, 0);
  }
});

test('ação persiste NF confirmada, mantém bloqueio após timeout e só retoma rejeição antes de emitir', async () => {
  const success = actionHarness();
  assert.equal((await success.actions.invoiceOrderAction(id, true)).billingOutcome, 'confirmed');
  assert.equal(success.records.invoice.omie_invoice_number, '123');
  assert.equal(success.records.writes.at(-1).omie_last_error, null);
  assert.equal(success.records.audits.at(-1).action, 'omie.invoice.result');
  const timeout = actionHarness({ timeout: true });
  assert.equal((await timeout.actions.invoiceOrderAction(id, true)).billingOutcome, 'unknown');
  assert.equal(timeout.records.invoice.status, 'billing_unknown');
  assert.equal((await timeout.actions.invoiceOrderAction(id, true)).billingOutcome, 'blocked');
  assert.equal(timeout.calls.filter(call => call.method === 'FaturarPedidoVenda').length, 1);
  const rejected = actionHarness({ invoice: { status: 'billing_rejected', fulfillment_id: id, omie_invoice_number: null, access_key: null } });
  assert.equal((await rejected.actions.invoiceOrderAction(id, true)).billingOutcome, 'confirmed');
});
