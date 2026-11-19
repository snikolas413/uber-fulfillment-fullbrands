import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('liberação é atômica, preserva emissão e etiquetas, respeita perfil e versão do pedido', async () => {
  const db = new PGlite();
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.user_id',true),'')::uuid$$;
      create function private.user_has_role(text[]) returns boolean language sql as $$select auth.uid() is not null and current_setting('app.profile',true)=any($1)$$;
      create table fulfillments(id uuid primary key, status text, omie_order_id bigint, updated_at timestamptz,
        omie_send_started_at timestamptz,omie_last_error text);
      create table invoices(fulfillment_id uuid references fulfillments(id),status text,omie_invoice_number text,access_key text,confirmation_state text);
      create table shipments(fulfillment_id uuid unique references fulfillments(id),carrier_id text,service_code text,freight_amount numeric,
        package_count int, service_modality text,estimated_delivery_date date,status text,omie_last_sync_at timestamptz,
        updated_at timestamptz,label_generation_state text default 'none',label_storage_path text);
      create table audit_logs(actor_id uuid,entity_type text,entity_id uuid,action text,source text,before_summary jsonb,after_summary jsonb);
      grant usage on schema auth,private to authenticated;
      grant select,insert,update,delete on all tables in schema public to authenticated;`);
    await db.exec(readFileSync('supabase/migrations/20261119124149_manual_freight_confirmation.sql','utf8'));
    await db.query("insert into fulfillments values($1,'order_created',123,'2026-11-19T12:00:00Z',null,'Frete: Antigo')",[id]);
    await db.exec('set role authenticated');
    await db.query("select set_config('app.user_id',$1,false),set_config('app.profile','operador',false)",[id]);
    const freight = { carrier_id: '2757271756', service_code: 'Mini Envios', freight_amount: 0, package_count: 1,
      service_modality: '0', estimated_delivery_date: '2026-11-27' };
    const run = async (expected='2026-11-19T12:00:00Z', patch={}) => db.query('select confirm_manual_freight($1,$2,123,true,$3)',[id,expected,{...freight,...patch}]);
    await assert.rejects(run(undefined,{freight_amount:15.99}),/INVALID_FREIGHT/);
    for (const state of ['billing_processing','billing_submitting','billing_submitted','billing_unknown','006']) {
      await db.query("insert into invoices values($1,$2,null,null,'none')",[id,state]);
      await assert.rejects(run(),/INVOICE_REGISTERED/);
      await db.query('delete from invoices where fulfillment_id=$1',[id]);
    }
    for (const state of ['processing','unknown','sources_ready','ready']) {
      await db.query("insert into shipments(fulfillment_id,label_generation_state) values($1,$2)",[id,state]);
      await assert.rejects(run(),/LABEL_REGISTERED/);
      await db.exec('reset role; delete from shipments; set role authenticated;');
    }
    await db.query("select set_config('app.profile','consulta',false)");
    await assert.rejects(run(),/FORBIDDEN/);
    await db.query("select set_config('app.profile','operador',false)");
    await assert.rejects(run('2026-11-18T12:00:00Z'),/ORDER_CHANGED/);
    assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,0);
    await run();
    assert.equal((await db.query('select omie_last_error from fulfillments')).rows[0].omie_last_error,null);
    assert.equal((await db.query('select freight_amount from shipments')).rows[0].freight_amount,'0');
    assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,0);
    assert.equal((await db.query('select after_summary from audit_logs')).rows[0].after_summary.invoice_requested,false);
    await assert.rejects(run(),/ORDER_CHANGED/);
    await db.exec('reset role; set role anon');
    await assert.rejects(run(),/permission denied/);
  } finally { await db.close(); }
});
