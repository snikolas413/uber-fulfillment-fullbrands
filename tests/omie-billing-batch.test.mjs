import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
const code = ts.transpileModule(readFileSync(new URL('../src/lib/omie/billing-batch.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;
new Function('exports', code)(exports);
const { runBillingBatch } = exports;

test('lote processa somente selecionados, uma vez e em sequência, continuando após falha', async () => {
  const calls = [], results = [];
  let active = 0;
  const processed = await runBillingBatch(['a', 'b', 'a', 'c'], {
    onStart() {}, onResult(id, result) { results.push([id, result]); },
    async invoice(id) {
      assert.equal(active++, 0);
      calls.push(id);
      await Promise.resolve();
      active--;
      if (id === 'b') throw new Error('Resposta perdida');
      return { status: 'success', message: 'Confirmado', billingOutcome: 'confirmed' };
    },
  });
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(processed, calls);
  assert.equal(results[1][1].billingOutcome, 'unknown');
  assert.equal(results[2][1].billingOutcome, 'confirmed');
});

test('interrupção termina o pedido atual e não inicia os demais', async () => {
  let stopped = false;
  const processed = await runBillingBatch(['a', 'b'], {
    onStart() {}, onResult() { stopped = true; }, shouldStop: () => stopped,
    async invoice() { return { status: 'warning', message: 'Recusa fiscal', billingOutcome: 'rejected' }; },
  });
  assert.deepEqual(processed, ['a']);
});

test('lote vazio ou acima do limite não solicita emissão', async () => {
  for (const ids of [[], Array.from({ length: 101 }, (_, index) => String(index))]) {
    await assert.rejects(runBillingBatch(ids, { onStart() {}, onResult() {}, async invoice() { assert.fail('Não pode emitir'); } }));
  }
});
