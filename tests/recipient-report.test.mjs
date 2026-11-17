import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

function load(path,modules={}) {
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('require','exports',code)(name=>{assert.ok(name in modules,'Unexpected module: '+name);return modules[name];},exports);
  return exports;
}
const report=load('../src/lib/recipient-report.ts');
const address={id:'a',postal_code:'05426200',street:'Rua Teste',number:'01',complement:null,district:'Centro',city:'São Paulo',state:'SP',validation_status:'pending',created_at:'2026-11-17T10:00:00Z'};
const person={id:'id',full_name:'João Silva',document_number:'01234567890',phone:'01199999999',email:'a@example.com',created_at:'2026-11-17T01:00:00Z',updated_at:'2026-11-17T01:00:00Z',delivery_addresses:[address]};
test('relatório tem uma linha por destinatário e usa só o endereço mais recente com desempate estável',()=>{
  const row={...person,delivery_addresses:[address,{...address,id:'b',city:'Niterói',validation_status:'manual_review'}]};
  const csv=report.recipientReportCsv([row,{...person,id:'empty',delivery_addresses:[]}]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"01234567890"/);assert.match(csv,/"05426200"/);
  assert.match(csv,/"Niterói"/);assert.doesNotMatch(csv,/"São Paulo"/);
  assert.match(csv,/"Revisão manual"/);assert.match(csv,/"Sem endereço"/);
  assert.match(csv,/16\/11\/2026, 22:00/);
  assert.equal(csv.split('\r\n').filter(Boolean).length,3);
});
test('CSV preserva acentos, aspas e quebras e neutraliza fórmulas',()=>{
  const csv=report.recipientReportCsv([{...person,full_name:'=HYPERLINK("url")',email:'\t+formula',delivery_addresses:[{...address,complement:'Casa; "2"\nFundos'}]}]);
  assert.match(csv,/"'=HYPERLINK\(""url""\)"/);
  assert.match(csv,/"'\t\+formula"/);
  assert.match(csv,/"Casa; ""2""\nFundos"/);
  assert.equal(report.recipientReportCsv([]),'\uFEFF'+report.RECIPIENT_REPORT_HEADERS.map(x=>'"'+x+'"').join(';')+'\r\n');
});
test('busca compartilha critérios por nome sem acento, CPF formatado e CEP',()=>{
  for(const query of ['joao','sao paulo','012.345.678-90','05426-200','a@example.com','SP']) assert.equal(report.matchesRecipientSearch(person,query),true,query);
  assert.equal(report.matchesRecipientSearch(person,'Niterói'),false);
  assert.equal(report.matchesRecipientSearch(person,'000'),false);
});
test('período inclui os dias completos de São Paulo, aceita limites abertos e valida datas reais',()=>{
  assert.deepEqual(report.recipientReportPeriod(),{});
  assert.deepEqual(report.recipientReportPeriod('2026-11-12','2026-11-12'),{from:'2026-11-12T03:00:00.000Z',until:'2026-11-13T03:00:00.000Z'});
  assert.deepEqual(report.recipientReportPeriod('2026-12-31',''),{from:'2026-12-31T03:00:00.000Z'});
  assert.deepEqual(report.recipientReportPeriod('','2024-02-29'),{until:'2024-03-01T03:00:00.000Z'});
  assert.equal(report.recipientReportPeriod('2018-11-04','').from,'2018-11-04T03:00:00.000Z');
  for(const [start,end] of [['2026-11-17','2026-11-12'],['2026-02-29',''],['2026-11-31',''],['17/11/2026',''],['','bad']]) assert.throws(()=>report.recipientReportPeriod(start,end));
});
test('consulta aplica o período no banco sem perder busca ou o último instante do dia',async()=>{
  const rows=[
    {...person,id:'1',created_at:'2026-11-12T02:59:59.999Z'},
    {...person,id:'2',created_at:'2026-11-12T03:00:00.000Z'},
    {...person,id:'3',created_at:'2026-11-13T02:59:59.999999Z'},
    {...person,id:'4',created_at:'2026-11-13T03:00:00.000Z'},
    {...person,id:'5',full_name:'Outra pessoa',created_at:'2026-11-12T14:00:00.000Z'},
  ];
  const requests=[];
  const client=createClient('https://example.supabase.co','test-key',{auth:{persistSession:false},global:{async fetch(input){
    const url=new URL(input);requests.push(url);
    let data=rows;
    for(const condition of url.searchParams.getAll('created_at')){
      const dot=condition.indexOf('.');const op=condition.slice(0,dot);const instant=Date.parse(condition.slice(dot+1));
      if(op==='gte')data=data.filter(row=>Date.parse(row.created_at)>=instant);
      if(op==='lt')data=data.filter(row=>Date.parse(row.created_at)<instant);
    }
    if(url.searchParams.has('id'))data=data.filter(row=>row.id>url.searchParams.get('id').slice(3));
    return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  }}});
  const result=await report.loadRecipientReport(client,'joao',report.recipientReportPeriod('2026-11-12','2026-11-12'));
  assert.deepEqual(result.map(row=>row.id),['2','3']);
  assert.ok(requests.every(url=>url.searchParams.getAll('created_at').includes('gte.2026-11-12T03:00:00.000Z')&&url.searchParams.getAll('created_at').includes('lt.2026-11-13T03:00:00.000Z')));
});
test('exportação alcança 1201 registros em páginas do servidor e falhas não geram arquivo parcial',async()=>{
  const rows=Array.from({length:1201},(_,i)=>({...person,id:String(i).padStart(5,'0'),full_name:'Pessoa '+i}));
  let pages=0;
  const client=createClient('https://example.supabase.co','test-key',{auth:{persistSession:false},global:{async fetch(input){
    const url=new URL(input);pages++;
    assert.equal(url.searchParams.get('delivery_addresses.limit'),'1');
    let data=rows.filter(row=>!url.searchParams.has('id')||row.id>url.searchParams.get('id').slice(3));
    data=data.slice(0,Math.min(200,Number(url.searchParams.get('limit'))));
    return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  }}});
  const loaded=await report.loadRecipientReport(client,'');
  assert.equal(loaded.length,1201);assert.equal(pages,8);assert.equal(new Set(loaded.map(row=>row.id)).size,1201);
  const selected=await report.loadRecipientReport(client,'Pessoa 1200');assert.equal(selected.length,1);
  const failed=createClient('https://example.supabase.co','test-key',{global:{fetch:async()=>new Response('{"message":"failure"}',{status:500,headers:{'content-type':'application/json'}})}});
  await assert.rejects(report.loadRecipientReport(failed,''),/todos os destinatários/);
});
test('endpoint exige sessão e perfil ativo, respeita busca e impede cache compartilhado',async()=>{
  for(const option of [{},{loggedOut:true},{inactive:true},{queryError:true}]) {
    let exported=0;
    const client={auth:{async getUser(){return {data:{user:option.loggedOut?null:{id:'user'}}};}},from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{is_active:!option.inactive}};}};return q;}};
    const api=load('../src/app/api/destinatarios/relatorio/route.ts',{'@/lib/supabase/server':{createSupabaseServerClient:async()=>client},'@/lib/recipient-report':{...report,async loadRecipientReport(_client,search){exported++;assert.equal(search,'João');if(option.queryError)throw new Error('database');return [person];}}});
    const response=await api.GET(new Request('https://example.com/api/destinatarios/relatorio?q=Jo%C3%A3o'));
    assert.equal(response.status,option.loggedOut?401:option.inactive?403:option.queryError?500:200);
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    if(option.loggedOut||option.inactive)assert.equal(exported,0);
    if(response.status===200){assert.match(response.headers.get('Content-Disposition'),/attachment; filename="destinatarios-/);assert.equal(response.headers.get('X-Report-Row-Count'),'1');assert.match(await response.text(),/01234567890/);}
  }
});
test('endpoint rejeita períodos inválidos antes de consultar e envia os limites validados ao relatório',async()=>{
  const calls=[];
  const client={auth:{async getUser(){return {data:{user:{id:'user'}}};}},from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{is_active:true}};}};return q;}};
  const api=load('../src/app/api/destinatarios/relatorio/route.ts',{'@/lib/supabase/server':{createSupabaseServerClient:async()=>client},'@/lib/recipient-report':{...report,async loadRecipientReport(_client,search,period){calls.push({search,period});return [];}}});
  for(const query of ['start=2026-11-18&end=2026-11-12','start=2026-02-30','end=invalid']){
    assert.equal((await api.GET(new Request('https://example.com/report?'+query))).status,400);
  }
  assert.equal(calls.length,0);
  const response=await api.GET(new Request('https://example.com/report?q=joao&start=2026-11-12&end=2026-11-12'));
  assert.equal(response.status,200);
  assert.deepEqual(calls,[{search:'joao',period:{from:'2026-11-12T03:00:00.000Z',until:'2026-11-13T03:00:00.000Z'}}]);
  assert.match(response.headers.get('Content-Disposition'),/destinatarios-2026-11-12-a-2026-11-12.csv/);
});
