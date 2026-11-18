import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path, modules = {}, fetcher) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'require', 'fetch', code)(exports, name => {
    assert.ok(name in modules, name); return modules[name];
  }, fetcher);
  return exports;
}
const id = '11111111-1111-4111-8111-111111111111';

test('rota exige origem e confirmação e reutiliza ação com reserva e validação fiscal', async () => {
  const calls = [];
  const { POST } = load('../src/app/api/expedicao/preparar/route.ts', {
    '@/app/expedicao/label-actions': { async generateShippingLabelAction(...args) {
      calls.push(args); return { status: 'error', message: 'Sem permissão' };
    } },
  });
  const request = (body, origin = 'https://app.test') => new Request('https://app.test/api/expedicao/preparar', {
    method: 'POST', headers: { origin }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request({ id, confirmed: true }, 'https://outro.test'))).status, 403);
  assert.equal((await POST(request({ id, confirmed: false }))).status, 400);
  assert.equal((await POST(request({ id: 'invalid', confirmed: true }))).status, 400);
  assert.deepEqual(calls, []);
  const response = await POST(request({ id, confirmed: true }));
  assert.deepEqual(calls, [[id, true]]);
  assert.deepEqual(await response.json(), { status: 'error', message: 'Sem permissão' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('transporte não repete timeout, resposta desconhecida ou erro de etiqueta', async () => {
  for (const failure of ['timeout', 'nonjson', 'error']) {
    let calls = 0;
    const { prepareShippingLabel } = load('../src/lib/omie/shipping-label-request.ts', {}, async (url, options) => {
      calls++;
      assert.equal(url, '/api/expedicao/preparar');
      assert.deepEqual(JSON.parse(options.body), { id, confirmed: true });
      if (failure === 'timeout') throw new TypeError('timeout');
      if (failure === 'nonjson') return new Response('Bad gateway', { status: 502 });
      return Response.json({ status: 'error', message: 'Pausa', retryAt: 62000 });
    });
    if (failure === 'error') assert.deepEqual(await prepareShippingLabel(id, true), { status: 'error', message: 'Pausa', retryAt: 62000 });
    else await assert.rejects(prepareShippingLabel(id, true));
    assert.equal(calls, 1);
  }
});

test('sucesso exige resposta HTTP válida e URL da etiqueta do próprio pedido', async () => {
  for (const [status, url, accepted] of [
    [200, '/api/expedicao/' + id + '/etiqueta', true],
    [200, '/api/expedicao/outro/etiqueta', false],
    [200, null, false],
    [502, '/api/expedicao/' + id + '/etiqueta', false],
  ]) {
    let calls = 0;
    const { prepareShippingLabel } = load('../src/lib/omie/shipping-label-request.ts', {}, async () => {
      calls++; return Response.json({ status: 'success', message: 'Pronta', url }, { status });
    });
    if (accepted) assert.equal((await prepareShippingLabel(id, true)).url, url);
    else await assert.rejects(prepareShippingLabel(id, true));
    assert.equal(calls, 1);
    await assert.rejects(prepareShippingLabel(id, false));
    assert.equal(calls, 1);
  }
});
