import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path, modules = {}) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => {
    if (!(name in modules)) throw new Error('Unexpected import: ' + name);
    return modules[name];
  }, exports);
  return exports;
}
const control = load('../src/lib/omie/request-control.ts');

async function withClient(body, { bearer = false } = {}) {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OMIE_APP_KEY, previousSecret = process.env.OMIE_APP_SECRET;
  if (bearer) { delete process.env.OMIE_APP_KEY; delete process.env.OMIE_APP_SECRET; }
  else { process.env.OMIE_APP_KEY = 'test-key'; process.env.OMIE_APP_SECRET = 'test-secret'; }
  const calls = [], finishes = [];
  let time = Date.now();
  const client = load('../src/lib/omie/client.ts', {
    'server-only': {},
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ async rpc(method) {
      assert.equal(method, 'get_omie_credentials');
      return { data: JSON.stringify({ appHash: 'test', accessToken: 'test', refreshToken: 'test', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }) };
    } }) },
    '@/lib/omie/request-control': { ...control, createOmieRequestControl: options => control.createOmieRequestControl({ ...options, now: () => time, async wait(ms) { time += ms; } }) },
    '@/lib/omie/request-reservation': { async acquireOmieRequest() { return { lease: 'lease', waitMs: 0 }; }, async finishOmieRequest(lease, seconds) { finishes.push(seconds); } },
  });
  try {
    await body({ client, calls, finishes, fetch(handler) { globalThis.fetch = async (url, options) => { calls.push({ url, method: JSON.parse(options.body).call }); return handler(); }; } });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OMIE_APP_KEY; else process.env.OMIE_APP_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.OMIE_APP_SECRET; else process.env.OMIE_APP_SECRET = previousSecret;
  }
}

test('cliente trata HTTP, faultstring, status de negócio, timeout e JSON inválido sem repetir a API', async () => {
  for (const response of [
    () => new Response(JSON.stringify({ faultcode: 'REDUNDANT', faultstring: 'Aguarde 20 segundos' })),
    () => new Response(JSON.stringify({ cCodStatus: '100', cDesStatus: 'Cotação indisponível' })),
    () => new Response(JSON.stringify({ codigo_status: '1', descricao_status: 'Dados inválidos' })),
    () => new Response(JSON.stringify({ faultcode: 'SOAP-ENV:Client', faultstring: 'Pedido com dados fiscais inválidos' }), { status: 500 }),
    () => new Response('{}', { status: 503 }),
    () => new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } }),
    () => { throw new Error('Timeout'); },
    () => new Response('não é JSON'),
    () => new Response('[]'),
    () => new Response('42'),
  ]) {
    await withClient(async h => {
      h.fetch(response);
      await assert.rejects(h.client.callOmie('/produtos/frete/', 'CotarFrete', { nIdPedido: 1 }));
      h.fetch(() => new Response(JSON.stringify({ cCodStatus: '0' })));
      if (h.finishes[0] > 0) {
        await assert.rejects(h.client.callOmie('/produtos/frete/', 'CotarFrete', { nIdPedido: 2 }), /Integração pausada/);
        assert.equal(h.calls.length, 1);
        assert.equal(h.finishes.length, 1);
      } else {
        await h.client.callOmie('/produtos/frete/', 'CotarFrete', { nIdPedido: 2 });
        assert.equal(h.calls.length, 2);
        assert.deepEqual(h.finishes, [0, 0]);
      }
    });
  }
});

test('401 Bearer não renova nem repete a operação recusada na mesma ação', async () => {
  await withClient(async h => {
    h.fetch(() => new Response('{}', { status: 401 }));
    await assert.rejects(h.client.callOmie('/produtos/pedido/', 'IncluirPedido', {}), /HTTP 401/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].method, 'IncluirPedido');
    assert.ok(!h.calls.some(call => call.url.includes('refresh-token')));
  }, { bearer: true });
});

test('cliente reaproveita sucesso de cadastro, sem cache de inclusão de pedido', async () => {
  await withClient(async h => {
    h.fetch(() => new Response(JSON.stringify({ codigo_cliente_omie: 123 })));
    await h.client.callOmie('/geral/clientes/', 'ConsultarCliente', { codigo_cliente_omie: 123 });
    await h.client.callOmie('/geral/clientes/', 'ConsultarCliente', { codigo_cliente_omie: 123 });
    assert.equal(h.calls.length, 1);
    await h.client.callOmie('/produtos/pedido/', 'IncluirPedido', { id: 1 });
    await h.client.callOmie('/produtos/pedido/', 'IncluirPedido', { id: 2 });
    assert.equal(h.calls.length, 3);
  });
});
