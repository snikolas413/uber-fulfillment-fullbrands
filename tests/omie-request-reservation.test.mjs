import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function reservation({ paused = false, broken = false, busy = 1 } = {}) {
  let time = 1_800_000_000_000, calls = 0;
  const waits = [];
  class Clock extends Date { static now() { return time; } }
  class PausedError extends Error { constructor(retryAt) { super('API pausada'); this.retryAt = retryAt; } }
  const db = {
    async rpc(method, params) {
      assert.equal(method, 'acquire_omie_request'); assert.equal(params.p_lease, 'lease');
      calls++;
      if (broken) return { error: new Error('Banco indisponível') };
      return { data: calls <= busy ? { granted: false, retry_at: new Date(time + 120_000).toISOString() } : { granted: true, wait_ms: 300 } };
    },
    from(table) {
      assert.equal(table, 'omie_api_control');
      return { select() { return this; }, eq() { return this; }, async single() { return { data: { paused_until: paused ? new Date(time + 120_000).toISOString() : '-infinity' } }; } };
    },
  };
  const modules = { 'server-only': {}, 'node:crypto': { randomUUID: () => 'lease' }, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/omie/request-control': { OmieRequestPausedError: PausedError } };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/omie/request-reservation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'Date', 'setTimeout', code)(name => modules[name], exports, Clock, (callback, ms) => { waits.push(ms); time += ms; callback(); });
  return { acquire: exports.acquireOmieRequest, waits, calls: () => calls };
}

test('ocupação por outra operação aguarda a reserva sem recusar o pedido ou chamar Omie', async () => {
  const h = reservation({ busy: 3 });
  assert.deepEqual(await h.acquire(), { lease: 'lease', waitMs: 300 });
  assert.equal(h.calls(), 4);
  assert.deepEqual(h.waits, [1000, 1000, 1000]);
});

test('pausa geral ou controle indisponível retorna erro sem insistir na reserva', async () => {
  for (const options of [{ paused: true }, { broken: true }]) {
    const h = reservation(options);
    await assert.rejects(h.acquire());
    assert.equal(h.calls(), 1);
    assert.deepEqual(h.waits, []);
  }
});

test('reserva ocupada indefinidamente tem espera limitada', async () => {
  const h = reservation({ busy: Infinity });
  await assert.rejects(h.acquire());
  assert.equal(h.waits.length, 125);
});
