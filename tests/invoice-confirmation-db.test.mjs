import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('fila persistente respeita prazo, reserva exclusiva, usuário, expiração e só finaliza NF sincronizada', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.user_id',true),'')::uuid $$;
      create function private.user_has_role(text[]) returns boolean language sql as $$
        select auth.uid() is not null and current_setting('app.profile',true)=any($1) $$;
      grant usage on schema auth,private to authenticated;
      grant execute on function auth.uid(),private.user_has_role(text[]) to authenticated;
      create table public.fulfillments(id uuid primary key,omie_order_id bigint);
      create table public.invoices(id uuid primary key,fulfillment_id uuid references public.fulfillments(id),status text,
        omie_invoice_number text,access_key text,protocol text);
      grant select,update on public.invoices to authenticated;
      grant select on public.fulfillments to authenticated;`);
    await db.exec(readFileSync('supabase/migrations/20261118185739_invoice_confirmation_queue.sql', 'utf8'));
    const user = '11111111-1111-4111-8111-111111111111', secondUser = '22222222-2222-4222-8222-222222222222';
    const id = '33333333-3333-4333-8333-333333333333', lease = '44444444-4444-4444-8444-444444444444', nextLease = '55555555-5555-4555-8555-555555555555';
    await db.query('insert into fulfillments values($1,123)', [id]);
    await db.query("insert into invoices(id,fulfillment_id,status,confirmation_state,confirmation_next_check_at) values($1,$1,'billing_submitted','pending',now()+interval '1 minute')", [id]);
    await db.exec('set role authenticated');
    await db.query("select set_config('app.user_id',$1,false),set_config('app.profile','operador',false)", [user]);
    const claim = async token => (await db.query('select public.claim_invoice_confirmation($1) result', [token])).rows[0].result;
    const finish = async (token, state, attempted = true) => (await db.query("select public.finish_invoice_confirmation($1,$2,$3,now()+interval '1 minute',null,$4) result", [id, token, state, attempted])).rows[0].result;
    assert.equal(await claim(lease), null);
    await db.query("update invoices set confirmation_next_check_at=now()-interval '1 second'");
    assert.equal((await claim(lease)).fulfillment_id, id);
    assert.equal(await claim(nextLease), null);
    await db.query("select set_config('app.user_id',$1,false)", [secondUser]);
    assert.equal(await finish(lease, 'pending'), false);
    await db.query("select set_config('app.user_id',$1,false)", [user]);
    assert.equal(await finish(nextLease, 'pending'), false);
    assert.equal(await finish(lease, 'confirmed'), false);
    assert.equal(await finish(lease, 'pending', false), true);
    assert.equal((await db.query('select confirmation_attempts n from invoices')).rows[0].n, 0);
    assert.equal(await claim(nextLease), null);
    await db.query("update invoices set confirmation_next_check_at=now()-interval '1 second'");
    assert.ok(await claim(lease));
    await db.query("update invoices set confirmation_lease_until=now()-interval '1 second'");
    assert.ok(await claim(nextLease));
    assert.equal(await finish(lease, 'error'), false);
    await db.query("update invoices set status='006',omie_invoice_number='123',access_key=repeat('1',44),protocol='1'");
    assert.equal(await finish(nextLease, 'confirmed'), true);
    assert.equal((await db.query('select confirmation_attempts n from invoices')).rows[0].n, 1);
    assert.equal(await claim(lease), null);
    await db.query("select set_config('app.profile','consulta',false)");
    await assert.rejects(claim(lease), /FORBIDDEN/);
    await assert.rejects(finish(lease, 'error'), /FORBIDDEN/);
    await db.exec('reset role; set role anon;');
    await assert.rejects(claim(lease), /permission denied/);
  } finally { await db.close(); }
});
