import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/lib/omie/item-icms.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText)(exports);
const { resolveItemIcms, preserveOtherItemTaxes, hasCompleteItemIcms, simulateItemTaxes } = exports;
const args = { scenarioId: 777, customerId: 888, productId: 987, finalConsumer: 'S' };

function stub(options = {}) {
  const calls = [];
  const request = async (endpoint, method, params) => {
    calls.push({ endpoint, method, params });
    if (method === 'ConsultarProduto') return { codigo_produto: options.wrongProduct ? 1 : 987, recomendacoes_fiscais: { origem_mercadoria: options.origin ?? '1' } };
    if (method === 'ListarImpostosCenario') return { ...params, codigo_cenario: options.wrongScenario ? 1 : 777,
      impostos: { cst_icms: '00', modalidade_bc_icms: '3', aliquota_icms: 4, reducao_bc_icms: 0, perc_fcp_icms: 0, ...options.taxes } };
    if (method === 'SimularImpostos') return { codigo_cliente: params.codigo_cliente, det_simul_resp: [{ codigo_cenario_impostos_item: 777,
      produto_simul_resp: { ...params.det_simul[0].produto_simul }, imposto: {
        icms: options.emptyIcms ? {} : { cod_sit_trib_icms: '00', origem_icms: '1', modalidade_icms: '3', perc_red_base_icms: 0, aliq_icms: 4, base_icms: 500, valor_icms: 20 },
        cbs: { valor_cbs: 5 }, ipi: { cod_sit_trib_ipi: '50', aliq_ipi: 13, tipo_calculo_ipi: 'B', enquadramento_ipi: '999', base_ipi: 500, valor_ipi: 65 } },
    }] };
    throw new Error('Método inesperado: ' + method);
  };
  return { request, calls };
}

test('preenche os seletores do print pelo cenário e produto, sem congelar base ou valor', async () => {
  const { request, calls } = stub();
  assert.deepEqual(await resolveItemIcms(request, args), { icms: {
    cod_sit_trib_icms: '00', origem_icms: '1', modalidade_icms: '3', perc_red_base_icms: 0, aliq_icms: 4, perc_fcp_icms: 0,
  } });
  assert.deepEqual(calls.find(call => call.method === 'ListarImpostosCenario').params, { codigo_cenario: 777, codigo_cliente_omie: 888, codigo_produto: 987, consumo_final: 'S' });
  const changed = stub({ origin: '2', taxes: { cst_icms: '20', modalidade_bc_icms: '0', aliquota_icms: 12, reducao_bc_icms: 25 } });
  const result = await resolveItemIcms(changed.request, args);
  assert.equal(result.icms.aliq_icms, 12);
  assert.equal(result.icms.cod_sit_trib_icms, '20');
  assert.equal(result.icms.origem_icms, '2');
  assert.ok(!('base_icms' in result.icms));
  assert.ok(!('valor_icms' in result.icms));
});

test('não usa valores padrão para dados fiscais ausentes, fora da faixa ou com vínculo errado', async () => {
  for (const options of [{ wrongProduct: true }, { wrongScenario: true }, { origin: '' }, { taxes: { cst_icms: '' } },
    { taxes: { aliquota_icms: null } }, { taxes: { aliquota_icms: 101 } }, { taxes: { modalidade_bc_icms: '' } }]) {
    const { request } = stub(options);
    await assert.rejects(resolveItemIcms(request, args));
  }
  await assert.rejects(resolveItemIcms(async () => assert.fail('Não pode consultar sem cenário'), { ...args, scenarioId: 0 }));
});

test('preserva parâmetros dos outros tributos, sem reenviar bases e valores anteriores ou campos somente leitura', () => {
  assert.deepEqual(preserveOtherItemTaxes({
    ipi: { cod_sit_trib_ipi: '50', aliq_ipi: 13, base_ipi: 500, valor_ipi: 65 },
    pis_padrao: { cod_sit_trib_pis: '01', aliq_pis: 1.65, base_pis: 500, valor_pis: 8.25 },
    cbs: { aliquota_cbs: 0.9 }, unexpectedSecret: 'Não copiar',
  }), { ipi: { cod_sit_trib_ipi: '50', aliq_ipi: 13 }, pis_padrao: { cod_sit_trib_pis: '01', aliq_pis: 1.65 } });
});

test('simula o pedido com quantidade, preço, cenário e destino reais antes da inclusão', async () => {
  const { request, calls } = stub();
  const otherTaxes = await simulateItemTaxes(request, { ...args, quantity: 2, unitPrice: 111.53, deliveryState: 'SC' });
  const payload = calls[0].params;
  assert.equal(calls[0].method, 'SimularImpostos');
  assert.equal(payload.uf_entrega, 'SC');
  assert.deepEqual(payload.det_simul, [{ codigo_cenario_impostos_item: 777, produto_simul: { codigo_produto: 987, quantidade: 2, valor_unitario: 111.53, valor_desconto: 0 } }]);
  assert.equal(otherTaxes.ipi.aliq_ipi, 13);
  assert.equal(otherTaxes.ipi.base_ipi, 500);
  assert.equal(otherTaxes.ipi.valor_ipi, 65);
  assert.equal(otherTaxes.icms.valor_icms, 20);
  assert.ok(!('cbs' in otherTaxes));
  await assert.rejects(simulateItemTaxes(stub({ emptyIcms: true }).request, { ...args, quantity: 2, unitPrice: 111.53, deliveryState: 'SC' }), /UF de entrega SC/);
});

test('confere o cálculo de cada pedido sem usar a base 126,03 como constante', () => {
  const icms = { cod_sit_trib_icms: '00', origem_icms: '1', modalidade_icms: '3', perc_red_base_icms: 0, aliq_icms: 4, base_icms: 126.03, valor_icms: 5.04 };
  assert.equal(hasCompleteItemIcms({ icms }, false), true);
  assert.equal(hasCompleteItemIcms({ icms: { ...icms, base_icms: 200, valor_icms: 8 } }, false), true);
  for (const patch of [{ base_icms: 0 }, { valor_icms: 99 }, { origem_icms: '' }, { modalidade_icms: '' }, { aliq_icms: undefined }]) {
    assert.equal(hasCompleteItemIcms({ icms: { ...icms, ...patch } }, false), false);
  }
});
