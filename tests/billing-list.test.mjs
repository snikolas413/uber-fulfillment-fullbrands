import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const nativeRequire=createRequire(import.meta.url);
function load(file,modules={}){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>name in modules?modules[name]:nativeRequire(name),exports);return exports;}
const ops=load('src/lib/operations-list.ts');
function database(rows,failure=false){const requests=[];const client=createClient('https://example.supabase.co','test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{async fetch(input,init){
 const url=new URL(input);requests.push({url,method:init.method});if(failure)return new Response(JSON.stringify({message:'Falha'}),{status:500});
 let data=rows;for(const [field,expression]of url.searchParams){if(field.endsWith('_queue'))data=data.filter(row=>row[field]===expression.slice(3));if(field==='search_text')data=data.filter(row=>row.search_text?.includes(expression.slice(7,-1)));}
 const count=data.length,start=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??count);
 if(init.method==='HEAD')return new Response(null,{headers:{'content-range':'0-0/'+count}});
 if(start>count)return new Response(JSON.stringify({code:'PGRST103'}),{status:416});
 data=data.slice(start,start+limit);return new Response(JSON.stringify(data),{headers:{'content-type':'application/json','content-range':start+'-'+Math.max(start,start+data.length-1)+'/'+count}});
}}});return{client,requests};}
const rows=Array.from({length:1105},(_,i)=>({id:String(i),billing_queue:'billed',shipping_queue:'ready',search_text:'Pessoa '+i}));
test('filas paginadas alcançam mais de mil pedidos sem perdas e contam notas que avançaram',async()=>{
 const {client,requests}=database(rows);const ids=[];for(let page=1;page<=12;page++){const result=await ops.loadOperationList(client,'billing',{view:'billed',page,search:''});assert.equal(result.state.count,1105);assert.equal(result.state.pageCount,12);ids.push(...result.data.map(row=>row.id));}
 assert.equal(new Set(ids).size,1105);assert.ok(requests.every(x=>x.url.searchParams.get('limit')==='100'));assert.ok(requests.every(x=>x.method==='GET'));
 const shipping=await ops.loadOperationList(client,'shipping',{view:'ready',page:12,search:''});assert.equal(shipping.data.length,5);assert.equal(shipping.state.count,1105);
});
test('busca ocorre no servidor e totais globais permanecem independentes do filtro de texto',async()=>{
 const {client,requests}=database(rows);const result=await ops.loadOperationList(client,'billing',{view:'billed',page:1,search:'Pessoa 1104'});assert.equal(result.data.length,1);
 assert.equal(requests[0].url.searchParams.get('search_text'),'ilike.%Pessoa 1104%');const totals=await ops.operationTotals(client,'billing',ops.billingViews);assert.equal(totals.billed,1105);assert.equal(totals.ready,0);
});
test('página fora do intervalo é ajustada depois que a fila diminui',async()=>{const {client}=database(rows.slice(0,101));const result=await ops.loadOperationList(client,'billing',{view:'billed',page:100,search:''});assert.equal(result.error,null);assert.equal(result.state.page,2);assert.equal(result.data.length,1);});
test('consulta com falha não apresenta zero como um total válido',async()=>{const {client}=database([],true);assert.ok((await ops.loadOperationList(client,'shipping',{view:'ready',page:1,search:''})).error);const totals=await ops.operationTotals(client,'billing',ops.billingViews);assert.equal(totals.billed,null);});
test('parâmetros e links preservam fila, busca e página sem aceitar filtros desconhecidos',()=>{assert.deepEqual(ops.listParams({view:'other',q:'a,%b',page:'-1'},ops.billingViews,'ready'),{view:'ready',search:'a  b',page:1});const url=new URL(ops.listUrl('/faturamento','billed','Maria',3),'https://example.test');assert.equal(url.searchParams.get('view'),'billed');assert.equal(url.searchParams.get('page'),'3');});
test('tela fiscal recebe só a fila solicitada, não carrega preparações e não executa operação',async()=>{
 const {client,requests}=database(rows);const server={from(table){if(table!=='user_profiles')return client.from(table);const q={select(){return q;},eq(){return q;},async maybeSingle(){return{data:{role:'operador',is_active:true}};}};return q;},auth:{async getUser(){return{data:{user:{id:'user'}}};}}};
 const page=load('src/app/faturamento/page.tsx',{'next/navigation':{redirect(){assert.fail('Sessão autorizada');}},'@/lib/supabase/server':{async createSupabaseServerClient(){return server;}},'@/lib/operations-list':ops,'@/components/queue-navigation':{QueueFilters:()=>null,QueuePagination:()=>null},'./billing-management':{BillingManagement(props){assert.equal(props.count,1105);assert.equal(props.rows.length,5);assert.ok(props.rows.every(row=>row.billing_queue==='billed'));return React.createElement('div',null,'Fila validada');}}});
 const html=renderToStaticMarkup(await page.default({searchParams:Promise.resolve({view:'billed',page:'12'})}));assert.match(html,/Fila validada/);assert.doesNotMatch(html,/Preparações aguardando/);assert.ok(requests.every(x=>['GET','HEAD'].includes(x.method)));
});
