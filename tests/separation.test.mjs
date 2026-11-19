import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(file,modules={}){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in modules))throw Error(name);return modules[name];},exports);return exports;}
const helpers=load('src/lib/omie/separation.ts');
const config=[{cDescOperacao:'Venda de Produtos',etapas:[{cCodigo:'10',cDescricao:'Pedido',cInativo:'N'},{cCodigo:'20',cDescricao:'Separar Estoque',cInativo:'N'}]}];
const id='11111111-1111-4111-8111-111111111111',integration='UFB-'+id.replaceAll('-','');
function harness(options={}){
  const row={id,status:'order_created',omie_order_id:123,separation_state:options.state??'none',separation_omie_stage:null};
  const audits=[],calls=[];let stage=options.stage??'10';
  const db={auth:{async getUser(){return{data:{user:options.loggedOut?null:{id:'user'}}};}},from(table){
    let patch=null,conditions=[];
    const execute=()=>{
      if(table==='user_profiles')return{data:{is_active:true,role:options.role??'operador'}};
      if(table==='invoices')return{data:options.invoice??null};
      if(table==='audit_logs'){audits.push(patch);return{error:null};}
      const matches=conditions.every(([field,value])=>Array.isArray(value)?value.includes(row[field]):row[field]===value);
      if(patch&&matches)Object.assign(row,patch);
      return{data:matches?{...row}:null,error:null};
    };
    const q={select(){return q;},eq(k,v){conditions.push([k,v]);return q;},in(k,v){conditions.push([k,v]);return q;},like(){return q;},update(v){patch=v;return q;},insert(v){patch=v;return q;},async maybeSingle(){return execute();},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};return q;
  }};
  const request=async(endpoint,method,params)=>{
    calls.push({method,params});
    if(method==='ListarEtapasFaturamento')return{cadastros:options.config??config,total_de_paginas:1};
    if(method==='ConsultarPedido')return{pedido_venda_produto:{cabecalho:{codigo_pedido:options.wrongId?999:123,codigo_pedido_integracao:integration,etapa:stage},infoCadastro:{cancelado:options.cancelled?'S':'N',faturado:options.billed?'S':'N'}}};
    if(method==='StatusPedido')return{codigo_pedido:options.wrongId?999:123,codigo_pedido_integracao:integration,etapa:stage,cancelada:options.cancelled?'S':'N',faturada:options.billed?'S':'N',ListaNfe:[]};
    if(method==='TrocarEtapaPedido'){
      if(options.reject)return{codigo_status:'1',descricao_status:'Recusado'};
      if(!options.notMoved)stage=params.etapa;
      if(options.timeout)throw Error('Timeout');
      return{codigo_status:'0'};
    }
    assert.fail('Operação proibida '+method);
  };
  const action=load('src/app/separacao/actions.ts',{'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{async createSupabaseServerClient(){return db;}},'@/lib/omie/client':{callOmie:request},'@/lib/omie/separation':helpers}).sendToSeparationAction;
  return{row,calls,audits,action};
}
test('identifica separação pela configuração de venda e recusa etapas ambíguas ou inativas',()=>{
  assert.equal(helpers.findSeparationStage(config),'20');
  for(const rows of [[],[...config,...config],[{...config[0],etapas:[{cCodigo:'50',cDescricao:'Separação',cInativo:'N'}]}],[{...config[0],etapas:[{cCodigo:'20',cDescricao:'Separação',cInativo:'S'}]}]])assert.throws(()=>helpers.findSeparationStage(rows));
});
test('envio confirmado troca somente a etapa, reconfere e libera faturamento com auditoria',async()=>{
  const h=harness();assert.equal((await h.action(id,true)).status,'success');
  assert.equal(h.row.separation_state,'confirmed');assert.equal(h.row.status,'billing_pending');assert.ok(h.row.separation_confirmed_at);
  assert.deepEqual(h.calls.map(c=>c.method),['ListarEtapasFaturamento','ConsultarPedido','TrocarEtapaPedido','StatusPedido']);
  assert.equal(h.audits.at(-1).after_summary.no_invoice_requested,true);
  await h.action(id,true);assert.equal(h.calls.length,4);
});
test('confirmação, perfil, cancelamento, vínculo e emissão existente bloqueiam o envio',async()=>{
  for(const options of [{},{role:'consulta'},{loggedOut:true},{cancelled:true},{billed:true},{wrongId:true},{invoice:{status:'billing_unknown',confirmation_state:'pending'}}]){
    const h=harness(options);assert.equal((await h.action(id,Boolean(Object.keys(options).length))).status,'error');assert.ok(!h.calls.some(c=>c.method==='TrocarEtapaPedido'));
  }
});
test('reserva exclusiva impede dois envios concorrentes do mesmo pedido',async()=>{
  const h=harness();await Promise.all([h.action(id,true),h.action(id,true)]);
  assert.equal(h.calls.filter(c=>c.method==='TrocarEtapaPedido').length,1);
});
test('timeout é recuperado por leitura sem repetir a mutação; resultado não confirmado continua bloqueado',async()=>{
  const h=harness({timeout:true});assert.equal((await h.action(id,true)).status,'error');assert.equal(h.row.separation_state,'unknown');
  assert.equal((await h.action(id,false)).status,'success');assert.equal(h.calls.filter(c=>c.method==='TrocarEtapaPedido').length,1);
  const uncertain=harness({notMoved:true});await uncertain.action(id,true);await uncertain.action(id,true);
  assert.equal(uncertain.row.separation_state,'unknown');assert.equal(uncertain.calls.filter(c=>c.method==='TrocarEtapaPedido').length,1);
});
test('recusa registra erro do pedido e permite processar o próximo',async()=>{
  const failed=harness({reject:true}),next=harness();
  assert.equal((await failed.action(id,true)).status,'error');assert.equal(failed.row.separation_state,'none');assert.match(failed.row.omie_last_error,/Recusado/);
  assert.equal((await next.action(id,true)).status,'success');
});
