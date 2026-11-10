// Temporary read-only production diagnostic. Never logs credentials or recipient data.
const key = process.env.OMIE_APP_KEY?.trim();
const secret = process.env.OMIE_APP_SECRET?.trim();
const base = (process.env.OMIE_API_BASE_URL ?? 'https://app.omie.com.br/api/v1').replace(/\/+$/, '');
async function request(method, params) {
  if (!['ConsultarPedido', 'SimularImpostos'].includes(method)) throw new Error('Read-only diagnostic');
  const response = await fetch(base + '/produtos/pedido/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: method, app_key: key, app_secret: secret, param: [params] }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok || body.faultstring) throw new Error(String(body.faultstring ?? 'HTTP ' + response.status).slice(0, 300));
  return body;
}
try {
  if (!key || !secret) console.log('ICMS_DIAG', JSON.stringify({ skipped: 'Private App Key/Secret unavailable' }));
  else {
    const order = (await request('ConsultarPedido', { codigo_pedido: 2958879854 })).pedido_venda_produto;
    if (order?.cabecalho?.codigo_pedido !== 2958879854) throw new Error('Order identity not confirmed');
    const item = order.det?.[0];
    if (!item?.produto?.codigo_produto) throw new Error('Item missing');
    const params = {
      codigo_cliente: order.cabecalho.codigo_cliente, consumidor_final: order.informacoes_adicionais.consumidor_final,
      frete_simul: { valor_frete: order.frete?.valor_frete ?? 0, valor_seguro: order.frete?.valor_seguro ?? 0, outras_despesas: order.frete?.outras_despesas ?? 0 },
      det_simul: [{ codigo_cenario_impostos_item: Number(item.inf_adic?.codigo_cenario_impostos_item ?? order.cabecalho.codigo_cenario_impostos),
        produto_simul: { codigo_produto: item.produto.codigo_produto, quantidade: item.produto.quantidade, valor_unitario: item.produto.valor_unitario, valor_desconto: item.produto.valor_desconto ?? 0 } }],
    };
    for (const context of ['delivery', 'customer']) {
      try {
        const result = await request('SimularImpostos', { ...params, ...(context === 'delivery' ? { uf_entrega: order.informacoes_adicionais.outros_detalhes.cEstadoOd } : {}) });
        const simulated = result.det_simul_resp?.[0];
        console.log('ICMS_DIAG', JSON.stringify({ context, order_id: 2958879854, scenario_id: params.det_simul[0].codigo_cenario_impostos_item,
          delivery_state: context === 'delivery' ? order.informacoes_adicionais.outros_detalhes.cEstadoOd : null,
          icms: simulated?.imposto?.icms ?? null, ipi: simulated?.imposto?.ipi ?? null,
          simulation_item: simulated?.produto_simul_resp ?? null, response_keys: Object.keys(result) }));
      } catch (error) { console.log('ICMS_DIAG', JSON.stringify({ context, error: error.message })); }
    }
  }
} catch (error) { console.log('ICMS_DIAG', JSON.stringify({ error: error.message })); }
