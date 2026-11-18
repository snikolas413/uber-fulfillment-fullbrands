import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => { if (!(name in modules)) throw new Error(name); return modules[name]; }, exports);
  return exports;
}
const fiscal = load('../src/lib/omie/shipping-invoice.ts');
const confirmation = load('../src/lib/omie/invoice-confirmation.ts', { './shipping-invoice': fiscal });
const prefix = '4226110000000000000055001000001234100000000';
let sum = 0;
for (let i=42, weight=2;i>=0;i--,weight=weight===9?2:weight+1) sum += Number(prefix[i])*weight;
const digit=11-sum%11;
const key=prefix+(digit>=10?0:digit);
const snapshot = () => ({ codigo_pedido: 123, codigo_pedido_integracao: 'UFB-test', faturada: 'S', cancelada: 'N',
  ListaNfe: [{ numero_nfe: '1234', serie_nfe: '001', chave_nfe: key, status_nfe: '006', tipo: 'S', protocolo: '123456' }] });

test('confirma somente NF autorizada com vínculo, número, série, chave válida e protocolo', () => {
  assert.equal(confirmation.inspectInvoiceConfirmation(snapshot(),123,'UFB-test').confirmed,true);
  for(const patch of [{faturada:'N'},{ListaNfe:[]},{ListaNfe:[{...snapshot().ListaNfe[0],chave_nfe:'invalid'}]},
    {ListaNfe:[{...snapshot().ListaNfe[0],numero_nfe:'999'}]}, {ListaNfe:[{...snapshot().ListaNfe[0],status_nfe:'001'}]},
    {ListaNfe:[{...snapshot().ListaNfe[0],protocolo:null}]},{ListaNfe:[{...snapshot().ListaNfe[0],tipo:'E'}]}]) {
    assert.equal(confirmation.inspectInvoiceConfirmation({...snapshot(),...patch},123,'UFB-test').confirmed,false);
  }
  for(const patch of [{codigo_pedido:456},{codigo_pedido_integracao:'other'},{cancelada:'S'},{ListaNfe:[...snapshot().ListaNfe,...snapshot().ListaNfe]}]) {
    assert.throws(()=>confirmation.inspectInvoiceConfirmation({...snapshot(),...patch},123,'UFB-test'));
  }
});

function worker(options = {}) {
  const calls = [], finishes = [], writes = [], audits = [], savedInvoices = [];
  const id = '11111111-1111-4111-8111-111111111111';
  const row = { id, omie_order_id: 123, omie_order_number: '123', status: 'billing_pending' };
  class ApiError extends Error {}
  const db = {
    auth: { getUser: async () => ({ data: { user: options.loggedOut ? null : { id: 'operator' } } }) },
    async rpc(method, params) {
      calls.push(method);
      if(method === 'claim_invoice_confirmation') return {data: options.noJob ? null : {invoice_id:'invoice',fulfillment_id:id,attempts:options.attempts ?? 0}};
      assert.equal(method,'finish_invoice_confirmation'); finishes.push(params); return {data:true};
    },
    from(table) {
      let patch;
      const q={select(){return q;},eq(){return q;},in(){return q;},is(){return q;},
        async maybeSingle(){return {data:table==='user_profiles'?{role:options.role??'operador',is_active:true}:row};},
        update(value){patch=value;return q;},upsert(value){savedInvoices.push(value);return q;},
        insert(value){audits.push(value);return q;},
        then(resolve){if(table==='fulfillments'&&patch)writes.push(patch);return Promise.resolve({error:null}).then(resolve);},
      };return q;
    },
  };
  const notes=load('../src/lib/omie/invoice-notes.ts');
  const payment=load('../src/lib/omie/payment-policy.ts');
  const icms=load('../src/lib/omie/item-icms.ts');
  const billing=load('../src/lib/omie/invoice-order.ts',{'@/lib/omie/item-icms':icms,'@/lib/omie/invoice-notes':notes,'@/lib/omie/payment-policy':payment});
  const actions=load('../src/app/pedidos/omie-actions.ts',{
    'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{createSupabaseServerClient:async()=>db},
    '@/lib/omie/invoice-confirmation':confirmation,'@/lib/omie/invoice-order':billing,
    '@/lib/omie/freight-selection':load('../src/lib/omie/freight-selection.ts'),'@/lib/omie/item-icms':icms,
    '@/lib/omie/order-reference':load('../src/lib/omie/order-reference.ts'),'@/lib/omie/invoice-notes':notes,'@/lib/omie/payment-policy':payment,
    '@/lib/omie/client':{OmieApiError:ApiError,OmieConfigurationError:ApiError,
      async callOmie(endpoint,method,params,settings){
        assert.equal(method,'StatusPedido','Confirmação só pode consultar, nunca emitir');
        assert.equal(settings.background,true);calls.push(method);
        if(options.busy)throw Object.assign(new ApiError('Aguardando reserva'),{code:'LOCAL_PAUSE',requestStarted:false,retryAt:Date.now()+61000});
        if(options.apiError)throw new ApiError('Falha na consulta fiscal');
        return {...snapshot(),codigo_pedido_integracao:params.codigo_pedido_integracao,...(options.pending?{ListaNfe:[]}:{}),...options.status};
      }},
  });
  return {run:actions.processNextInvoiceConfirmationAction,calls,finishes,writes,audits,savedInvoices};
}

test('processador independente só consulta e sincroniza NF autorizada, sem emitir novamente',async()=>{
  const h=worker();const result=await h.run();
  assert.equal(result.billingOutcome,'confirmed');assert.equal(result.invoiceNumber,'1234');
  assert.deepEqual(h.calls,['claim_invoice_confirmation','StatusPedido','finish_invoice_confirmation']);
  assert.equal(h.finishes[0].p_state,'confirmed');assert.equal(h.finishes[0].p_attempted,true);
  assert.equal(h.savedInvoices[0].access_key,key);assert.equal(h.savedInvoices[0].status,'006');
  assert.equal(h.writes[0].status,'billed');
});

test('NF pendente é reagendada; limite e erro ficam no pedido sem insistência na API',async()=>{
  const pending=worker({pending:true});
  assert.equal((await pending.run()).confirmationState,'pending');
  assert.equal(pending.finishes[0].p_state,'pending');assert.ok(pending.finishes[0].p_next_check_at);
  for(const options of [{pending:true,attempts:19},{apiError:true},{status:{codigo_pedido:999}}]){
    const h=worker(options);assert.equal((await h.run()).confirmationState,'error');
    assert.equal(h.finishes[0].p_state,'error');assert.equal(h.calls.filter(x=>x==='StatusPedido').length,1);
    assert.match(h.writes.at(-1).omie_last_error,/Confirmação NF-e:/);
  }
});

test('reserva ou janela indisponível adia confirmação sem contar consulta ou gerar erro do pedido',async()=>{
  const h=worker({busy:true});assert.equal((await h.run()).confirmationState,'pending');
  assert.equal(h.finishes[0].p_attempted,false);assert.equal(h.writes.length,0);
});

test('consulta não emite nem consome fila sem sessão, perfil de operação ou job vencido',async()=>{
  for(const options of [{loggedOut:true},{role:'consulta'},{noJob:true}]){
    const h=worker(options);assert.equal((await h.run()).hasJob,false);
    assert.equal(h.calls.includes('StatusPedido'),false);
  }
});
