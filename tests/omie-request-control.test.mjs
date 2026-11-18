import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/lib/omie/request-control.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(exports);
const { createOmieRequestControl, pauseSeconds, OmieRequestPausedError } = exports;

function harness(shared = { pausedUntil: 0, leased: false }) {
  let time = 1_800_000_000_000;
  const waits = [], finishes = [];
  const control = createOmieRequestControl({
    now: () => time,
    async wait(ms) { waits.push(ms); time += ms; },
    async acquire() {
      if (shared.pausedUntil > time) throw new OmieRequestPausedError(shared.pausedUntil);
      assert.equal(shared.leased, false);
      shared.leased = true;
      return { lease: 'test-lease', waitMs: 300 };
    },
    async finish(lease, seconds) {
      assert.equal(lease, 'test-lease'); shared.leased = false;
      finishes.push(seconds);
      if (seconds) shared.pausedUntil = time + seconds * 1000;
    },
  });
  return { control, waits, finishes, advance(ms) { time += ms; }, time: () => time, shared };
}

test('100 consultas estáveis idênticas concorrentes fazem uma chamada e não compartilham objetos mutáveis', async () => {
  const h = harness(); let calls = 0;
  const run = params => h.control('/geral/clientes/', 'ConsultarCliente', params, async () => { calls++; return { name: 'Correios' }; });
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => run(i % 2 ? { id: 1, active: true } : { active: true, id: 1 })));
  assert.equal(calls, 1);
  results[0].name = 'Mudou';
  assert.equal((await run({ id: 1, active: true })).name, 'Correios');
  h.advance(61_000);
  await run({ id: 1, active: true });
  assert.equal(calls, 2);
});

test('cache de impostos separa UF e parâmetros; consultas diferentes e escritas não são deduplicadas', async () => {
  const h = harness(); let calls = 0;
  const request = async () => { calls++; return { result: calls }; };
  await h.control('/pedido/', 'SimularImpostos', { uf: 'SC' }, request);
  await h.control('/pedido/', 'SimularImpostos', { uf: 'SP' }, request);
  await h.control('/pedido/', 'SimularImpostos', { uf: 'SC' }, request);
  await h.control('/pedido/', 'IncluirPedido', { id: 1 }, request);
  await h.control('/pedido/', 'IncluirPedido', { id: 1 }, request);
  assert.equal(calls, 4);
});

test('leituras fiscais e de pedidos são novas e aguardam antes da chamada redundante, sem erro e repetição', async () => {
  for (const method of ['ConsultarPedido', 'StatusPedido', 'ConsultarNF']) {
    const h = harness(); let calls = 0;
    const request = async () => ({ version: ++calls });
    assert.equal((await h.control('/pedido/', method, { id: 1 }, request)).version, 1);
    assert.equal((await h.control('/pedido/', method, { id: 1 }, request)).version, 2);
    assert.deepEqual(h.waits, [300, 61_000, 300]);
    await h.control('/pedido/', method, { id: 2 }, request);
    assert.equal(h.waits.length, 4);
    assert.equal(calls, 3);
  }
});

test('falha de um pedido não pausa os próximos e nunca repete a chamada daquele pedido', async () => {
  for (const method of ['ConsultarCliente', 'ConsultarPedido', 'CotarFrete', 'IncluirPedido', 'SelecionarFrete', 'FaturarPedidoVenda']) {
    const h = harness(); let calls = 0;
    const request = async () => { calls++; throw new Error('Falha no Omie'); };
    await assert.rejects(h.control('/api/', method, { id: 1 }, request), /Falha no Omie/);
    assert.equal(calls, 1);
    assert.deepEqual(h.finishes, [0]);
    assert.equal(h.shared.pausedUntil, 0);
    assert.equal(await h.control('/api/', method, { id: 2 }, async () => 'ok'), 'ok');
  }
});

test('425 pausa por 30 minutos; Retry-After e prazo da mensagem são respeitados', async () => {
  assert.equal(pauseSeconds({ httpStatus: 425 }), 1_800);
  assert.equal(pauseSeconds({ httpStatus: 429, retryAfterSeconds: 3_600 }), 3_600);
  assert.equal(pauseSeconds({ code: 'REDUNDANT', message: 'Aguarde 95 segundos' }), 0);
  assert.equal(pauseSeconds({ message: 'API bloqueada. Aguarde 30 minutos' }), 1_801);
  const h = harness();
  await assert.rejects(h.control('/api/', 'ConsultarPedido', {}, async () => { throw Object.assign(new Error('Consumo indevido'), { httpStatus: 425 }); }));
  assert.deepEqual(h.finishes, [1_800]);
});

test('pausa persistida bloqueia outro processo e falha no controle nunca chama a API', async () => {
  const h = harness();
  await assert.rejects(h.control('/api/', 'IncluirPedido', {}, async () => { throw Object.assign(new Error('Limite da API'), { httpStatus: 429 }); }));
  const restarted = harness(h.shared);
  await assert.rejects(restarted.control('/api/', 'IncluirPedido', {}, () => assert.fail('Sem chamada após reinício')));
  const broken = createOmieRequestControl({ async acquire() { throw new Error('Banco indisponível'); }, async finish() { assert.fail(); } });
  await assert.rejects(broken('/api/', 'IncluirPedido', {}, () => assert.fail('Não pode enviar sem proteção')));
});

test('recusa fiscal ou de frete não bloqueia outra operação; REDUNDANT só limita a mesma consulta', async () => {
  for (const code of ['FISCAL_INVALID', 'FRETE_INDISPONIVEL']) {
    const h = harness();
    await assert.rejects(h.control('/api/', 'ValidarPedidoVenda', { id: 1 }, async () => {
      throw Object.assign(new Error('Dados do pedido inválidos'), { httpStatus: 500, code });
    }));
    assert.equal(await h.control('/api/', 'GerarEtiqueta', { id: 2 }, async () => 'ok'), 'ok');
    assert.deepEqual(h.finishes, [0, 0]);
  }
  const h = harness();
  await assert.rejects(h.control('/pedido/', 'StatusPedido', { id: 1 }, async () => {
    throw Object.assign(new Error('REDUNDANT. Aguarde 95 segundos'), { code: 'REDUNDANT', httpStatus: 500 });
  }));
  const before = h.time();
  await h.control('/pedido/', 'StatusPedido', { id: 2 }, async () => 'ok');
  assert.equal(h.time() - before, 300);
  await h.control('/pedido/', 'StatusPedido', { id: 1 }, async () => 'ok');
  assert.ok(h.waits.some(ms => ms > 90_000));
  assert.equal(h.shared.pausedUntil, 0);
});

test('falha ao liberar reserva após resposta não repete a escrita e bloqueia próximas chamadas', async () => {
  let calls = 0;
  const control = createOmieRequestControl({ async acquire() { return { lease: 'lease', waitMs: 0 }; }, async finish() { throw new Error('Banco indisponível'); } });
  await assert.rejects(control('/api/', 'IncluirPedido', {}, async () => { calls++; return { codigo_pedido: 123 }; }));
  await assert.rejects(control('/api/', 'IncluirPedido', {}, async () => { calls++; }));
  assert.equal(calls, 1);
});
