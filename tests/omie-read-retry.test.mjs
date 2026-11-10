import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const exports = {};
const code = ts.transpileModule(readFileSync(new URL('../src/lib/omie/read-retry.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;
new Function('exports', code)(exports);
const { withRedundantReadRetry } = exports;
const redundant = () => Object.assign(new Error('Consumo redundante detectado. Aguarde 43 segundos para tentar novamente (REDUNDANT).'), { code: 'REDUNDANT' });

test('consulta aguarda o prazo REDUNDANT e recupera a confirmação sem nova escrita', async () => {
  const waits = [];
  let attempts = 0;
  const result = await withRedundantReadRetry('ConsultarPedido', async () => {
    if (++attempts === 1) throw redundant();
    return { frete: { codigo_transportadora: 123 } };
  }, async ms => { waits.push(ms); });
  assert.equal(result.frete.codigo_transportadora, 123);
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [44000]);
});

test('não repete inclusão, seleção, faturamento ou cotação por REDUNDANT', async () => {
  for (const method of ['IncluirPedido', 'SelecionarFrete', 'FaturarPedidoVenda', 'CancelarCotacao', 'CotarFrete']) {
    let attempts = 0;
    await assert.rejects(withRedundantReadRetry(method, async () => { attempts++; throw redundant(); }, async () => assert.fail('Não deve aguardar')));
    assert.equal(attempts, 1);
  }
});

test('segunda recusa é devolvida sem loop; outros erros e prazos inválidos não são repetidos', async () => {
  let attempts = 0;
  await assert.rejects(withRedundantReadRetry('ConsultarPedido', async () => { attempts++; throw redundant(); }, async () => {}));
  assert.equal(attempts, 2);
  for (const message of ['403 FORBIDDEN', 'REDUNDANT sem prazo', 'REDUNDANT Aguarde 600 segundos', 'REDUNDANT Aguarde 0 segundos']) {
    let calls = 0;
    await assert.rejects(withRedundantReadRetry('StatusPedido', async () => { calls++; throw new Error(message); }, async () => assert.fail('Não deve aguardar')));
    assert.equal(calls, 1);
  }
});
