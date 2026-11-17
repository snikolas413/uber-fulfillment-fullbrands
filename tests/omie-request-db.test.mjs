import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('reserva persistente limita concorrência, mantém a pausa e é inacessível a usuários do app', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync('supabase/migrations/20261117162930_omie_request_protection.sql', 'utf8'));
    const lease = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const acquire = async id => (await db.query('select public.acquire_omie_request($1) as result', [id])).rows[0].result;
    const finish = async (id, seconds) => (await db.query('select public.finish_omie_request($1,$2) as result', [id, seconds])).rows[0].result;
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(acquire(lease), /permission denied/);
      await assert.rejects(db.query('select * from public.omie_api_control'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const first = await acquire(lease);
    assert.equal(first.granted, true);
    assert.equal(first.wait_ms, 0);
    assert.equal((await acquire(other)).granted, false);
    assert.equal(await finish(other, 0), false);
    assert.equal(await finish(lease, 0), true);
    const next = await acquire(other);
    assert.equal(next.granted, true);
    assert.ok(next.wait_ms > 0 && next.wait_ms <= 300);
    assert.equal(await finish(other, 1800), true);
    const paused = await acquire(lease);
    assert.equal(paused.granted, false);
    assert.ok(Date.parse(paused.retry_at) > Date.now() + 1790_000);
    assert.equal(await finish(other, 0), false);
    assert.equal((await acquire(lease)).retry_at, paused.retry_at);
    await assert.rejects(finish(lease, -1), /INVALID_PAUSE/);
    await assert.rejects(finish(lease, 86401), /INVALID_PAUSE/);
    await db.exec("update public.omie_api_control set paused_until='-infinity',lease_until=clock_timestamp()-interval '1 second'");
    assert.equal((await acquire(lease)).granted, true);
    await db.exec("update public.omie_api_control set lease_until=clock_timestamp()-interval '1 second'");
    assert.equal((await acquire(other)).granted, true);
    assert.equal(await finish(lease, 0), false);
    assert.equal(await finish(other, 0), true);
  } finally { await db.close(); }
});
