import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('automation exclusion blocks CPF, recipient and order reuse without blocking other orders', async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema private; grant usage on schema private to authenticated;
 create table public.recipients(id uuid primary key,document_number text);
 create table public.fulfillments(id uuid primary key,recipient_id uuid,omie_order_id bigint,status text);
 create table public.invoices(id uuid primary key,fulfillment_id uuid,status text);
 grant select,insert,update on public.fulfillments,public.invoices to authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/20261118162846_automation_order_exclusion_guards.sql','utf8'));
 const rid='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', old='33333333-3333-4333-8333-333333333333';
 await db.query("insert into public.recipients values ($1,'01234567890'),($2,'12345678909')",[rid,other]);
 await db.query("insert into private.automation_order_blocks(document_number,recipient_id,fulfillment_id,omie_order_id,reason) values ('01234567890',$1,$2,1234567890,'test')",[rid,old]);
 const insert=(id,recipient,omie=null)=>db.query("insert into public.fulfillments values($1,$2,$3,'ready')",[id,recipient,omie]);
 const fresh='44444444-4444-4444-8444-444444444444';
 for(const role of ['authenticated','service_role']){
 await db.exec('set role '+role);
 await assert.rejects(insert(fresh,rid),/bloqueado/);
 await assert.rejects(insert(old,other),/bloqueado/);
 await assert.rejects(insert(fresh,other,1234567890),/bloqueado/);
 await assert.rejects(db.query("insert into public.invoices values($1,$2,'billing_processing')",[fresh,old]),/bloqueado/);
 await assert.rejects(db.query('select * from private.automation_order_blocks'),/permission denied/);
 await db.exec('reset role');
 }
 await db.query("update public.recipients set document_number='12345678909' where id=$1",[rid]);
 await assert.rejects(insert(fresh,rid),/bloqueado/);
 for(const cpf of ['012.345.678-90','1234567890']){
 await db.query('update public.recipients set document_number=$1 where id=$2',[cpf,other]);
 await assert.rejects(insert(fresh,other),/bloqueado/);
 }
 await db.query("update public.recipients set document_number='12345678909' where id=$1",[other]);
 await insert(fresh,other);
 await assert.rejects(db.query('update public.fulfillments set omie_order_id=1234567890 where id=$1',[fresh]),/bloqueado/);
 assert.equal((await db.query('select count(*)::int count from public.fulfillments')).rows[0].count,1);
 } finally {await db.close();}
});
