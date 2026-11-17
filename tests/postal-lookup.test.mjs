import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function client(fetch) {
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../src/lib/postal-lookup.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('require','exports','fetch',code)(()=>({}),exports,fetch);
  return exports.lookupPostalAddress;
}
const postal={cep:'05426-200',logradouro:'Rua Teste',bairro:'Centro',localidade:'São Paulo',uf:'SP'};
test('consulta transmite apenas CEP e compartilha requisições em andamento e cache',async()=>{
  const calls=[];
  const lookup=client(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>postal};});
  const [first,second]=await Promise.all([lookup('05426200'),lookup('05426200')]);
  assert.deepEqual(first,second);await lookup('05426200');assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://viacep.com.br/ws/05426200/json/');
  assert.equal(calls[0].options.body,undefined);
  assert.equal(await lookup('05426200/../../bad'),null);assert.equal(calls.length,1);
});
test('não aceita CEP divergente, JSON inválido ou HTTP recusado e pausa consultas durante indisponibilidade',async()=>{
  for(const response of [{ok:false},{ok:true,json:async()=>({...postal,cep:'00000-000'})},{ok:true,json:async()=>null}]){
    let requests=0;
    const lookup=client(async()=>{requests++;return response;});
    await assert.rejects(lookup('05426200'));await assert.rejects(lookup('05426200'));
    await assert.rejects(lookup('01001000'));
    assert.equal(requests,1);
  }
  let requests=0;
  const lookup=client(async()=>{requests++;return {ok:true,json:async()=>({erro:true})};});
  assert.equal(await lookup('05426200'),null);assert.equal(await lookup('05426200'),null);assert.equal(requests,1);
});
