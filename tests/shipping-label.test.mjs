import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as pdfLib from 'pdf-lib';
import bwipjs from 'bwip-js/node';
const require = createRequire(import.meta.url);
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', code)(name => name in modules ? modules[name] : require(name), exports);
  return exports;
}
const fiscal = load('../src/lib/omie/shipping-invoice.ts');
const download = load('../src/lib/omie/label-download.ts');
const generation = load('../src/lib/omie/generate-shipping-label.ts', { './label-download': download });
const pdf = load('../src/lib/omie/shipping-label-pdf.ts', { './shipping-invoice': fiscal, 'bwip-js/node': bwipjs, 'pdf-lib': pdfLib });

const prefix = '4226110000000000000055001000001234100000000';
let sum = 0;
for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(prefix[i]) * weight;
const digit = 11 - sum % 11;
const key = prefix + (digit >= 10 ? 0 : digit);
const invoice = { key, number: '00001234', series: '001', issuedDate: '11/11/2026', orderNumber: 'DEMONSTRACAO' };

function omie(options = {}) {
  const calls = [];
  const request = async (endpoint, method, params) => {
    calls.push({ endpoint, method, params });
    const note = { chave_nfe: key, numero_nfe: invoice.number, serie_nfe: '001', protocolo: 1, status_nfe: options.unapproved ? '001' : '006', tipo: 'S' };
    if (method === 'StatusPedido') return { codigo_pedido: options.wrongOrder ? 2 : 1, codigo_pedido_integracao: 'local', numero_pedido: 'demo', cancelada: options.cancelled ? 'S' : 'N', faturada: options.notBilled ? 'N' : 'S', ListaNfe: options.ambiguous ? [note, note] : [note] };
    if (method === 'ConsultarNF') return { compl: { cChaveNFe: options.wrongKey ? key.slice(0, 43) + 'x' : key, nIdPedido: options.wrongInvoice ? 2 : 1 },
      ide: { nNF: options.wrongNumber ? '1235' : invoice.number, serie: '001', dEmi: invoice.issuedDate, hEmi: '10:17:31', dCan: options.nfCancelled ? '11/11/2026' : '', cDeneg: options.denied ? 'S' : 'N', mod: '55', tpNF: '1' } };
    assert.fail('Unexpected operation ' + method);
  };
  return { request, calls };
}

test('chave com 44 dígitos valida modelo e dígito verificador, sem aceitar chave truncada', () => {
  assert.equal(fiscal.validNfeKey(key), true);
  for (const invalid of [key.slice(1), key + '0', key.slice(0, 43) + ((Number(key[43]) + 1) % 10), key.replace('55001', '65001')]) assert.equal(fiscal.validNfeKey(invalid), false);
});

test('lê NF-e autorizada e confirma chave, número, série, pedido e data reais sem gerar etiqueta ou faturar', async () => {
  const { request, calls } = omie();
  const result = await fiscal.readShippingInvoice(request, 1, 'local');
  assert.equal(result.key, key); assert.equal(result.number, '00001234');
  assert.equal(result.issuedAt, '2026-11-11T10:17:31-03:00');
  assert.deepEqual(calls.map(call => call.method), ['StatusPedido', 'ConsultarNF']);
  for (const options of [{ wrongOrder: true }, { cancelled: true }, { notBilled: true }, { unapproved: true }, { ambiguous: true }, { wrongKey: true }, { wrongInvoice: true }, { nfCancelled: true }, { denied: true }, { wrongNumber: true }]) {
    await assert.rejects(fiscal.readShippingInvoice(omie(options).request, 1, 'local'));
  }
});

function store() {
  const state = { state: 'none', sources: null, claims: 0 };
  Object.assign(state, {
    async claim() { if (state.state !== 'none') return false; state.claims++; state.state = 'processing'; return true; },
    async saveSources(sources) { state.sources = sources; state.state = 'sources_ready'; },
    async markUnknown() { state.state = 'unknown'; }, async markRejected() { state.state = 'none'; },
  });
  return state;
}

test('geração usa nIdPedido, persiste links e recupera PDFs sem solicitar nova etiqueta', async () => {
  const saved = store(); let calls = 0;
  const request = async (endpoint, method, params) => { calls++; assert.equal(method, 'GerarEtiqueta'); assert.deepEqual(params, { nIdPedido: 123 }); return { cCodStatus: '0', listaEtiqueta: [{ cUrlEtiqueta: 'https://cdn.omie.com.br/label.pdf' }] }; };
  const first = await generation.getLabelSources(request, 123, saved);
  assert.deepEqual(await generation.getLabelSources(request, 123, saved), first);
  assert.equal(calls, 1); assert.equal(saved.state, 'sources_ready');
});

test('concorrência e timeout não repetem a geração; recusa explícita permite nova ação manual', async () => {
  const saved = store(); let calls = 0;
  const request = async () => { calls++; throw new Error('Timeout'); };
  await Promise.allSettled([generation.getLabelSources(request, 123, saved), generation.getLabelSources(request, 123, saved)]);
  await assert.rejects(generation.getLabelSources(request, 123, saved));
  assert.equal(calls, 1); assert.equal(saved.state, 'unknown');
  const rejected = store();
  await assert.rejects(generation.getLabelSources(async () => ({ cCodStatus: '1', cDesStatus: 'Encomenda não disponível' }), 123, rejected), /Encomenda não disponível/);
  assert.equal(rejected.state, 'none');
});

test('downloads só aceitam PDFs de hosts autorizados, verificando redirecionamento, tamanho e conteúdo', async () => {
  for (const url of ['http://cdn.omie.com.br/x', 'https://127.0.0.1/x', 'https://omie.com.br.evil.test/x', 'https://user:pass@cdn.omie.com.br/x', 'https://cdn.omie.com.br:444/x']) assert.throws(() => download.assertLabelUrl(url));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
    await assert.rejects(download.downloadOmieLabel('https://cdn.omie.com.br/x'));
    globalThis.fetch = async () => new Response('<html>Login</html>');
    await assert.rejects(download.downloadOmieLabel('https://cdn.omie.com.br/x'), /PDF válido/);
    globalThis.fetch = async () => new Response('too big', { headers: { 'content-length': String(21 * 1024 * 1024) } });
    await assert.rejects(download.downloadOmieLabel('https://cdn.omie.com.br/x'), /20 MB/);
    globalThis.fetch = async () => new Response('%PDF-1.7\n');
    assert.ok((await download.downloadOmieLabel('https://cdn.omie.com.br/x')).length > 0);
  } finally { globalThis.fetch = originalFetch; }
});

async function sampleLabel(width = 283.4646, height = 340.1575) {
  const doc = await pdfLib.PDFDocument.create();
  const page = doc.addPage([width, height]);
  page.drawRectangle({ x: 4, y: 4, width: width - 8, height: height - 8, borderWidth: 0.6, color: pdfLib.rgb(1, 1, 1), borderColor: pdfLib.rgb(0, 0, 0) });
  page.drawText('FULLBRANDS', { x: 13, y: height - 28, size: 16 });
  page.drawText('DEMONSTRACAO - SEM VALOR POSTAL', { x: 13, y: height - 44, size: 8 });
  page.drawText('MINI ENVIOS CONTRATO AG', { x: 55, y: height - 67, size: 11 });
  const tracking = await doc.embedPng(await bwipjs.toBuffer({ bcid: 'code128', text: 'AV000000000BR', scale: 3, height: 12, paddingwidth: 10, backgroundcolor: 'FFFFFF' }));
  page.drawImage(tracking, { x: 15, y: height - 125, width: width - 30, height: 42 });
  page.drawText('DESTINATARIO', { x: 13, y: height - 150, size: 10 });
  page.drawText('Destinatario de demonstracao', { x: 13, y: height - 169, size: 11 });
  page.drawText('Rua de Exemplo, 100 - Centro', { x: 13, y: height - 188, size: 9 });
  page.drawText('20000-000 - Rio de Janeiro / RJ', { x: 13, y: height - 209, size: 10 });
  page.drawText('REMETENTE: EMPRESA DE DEMONSTRACAO', { x: 13, y: 52, size: 8 });
  page.drawText('Documento de teste, nao utilizar para postagem.', { x: 13, y: 35, size: 7 });
  return doc.save();
}

test('PDF mantém a etiqueta e adiciona NF-e em uma página exata de 100x150 mm por volume', async () => {
  const original = await sampleLabel();
  const bytes = await pdf.composeShippingLabel([original], invoice, 1);
  const result = await pdfLib.PDFDocument.load(bytes);
  assert.equal(result.getPageCount(), 1);
  assert.ok(Math.abs(result.getPage(0).getWidth() - 100 * 72 / 25.4) < 0.001);
  assert.ok(Math.abs(result.getPage(0).getHeight() - 150 * 72 / 25.4) < 0.001);
  await assert.rejects(pdf.composeShippingLabel([original], invoice, 2), /volumes/);
  const a4 = await pdfLib.PDFDocument.create(); a4.addPage([595, 842]);
  await assert.rejects(pdf.composeShippingLabel([await a4.save()], invoice, 1), /formato de etiqueta individual/);
  mkdirSync(new URL('../outputs/labels/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../outputs/labels/demonstracao-etiqueta-100x150.pdf', import.meta.url), bytes);
});

test('geração exige confirmação, sessão e perfil de operação antes de consultar Omie', async () => {
  for (const options of [{ confirmed: false }, { loggedOut: true }, { role: 'consulta' }, { inactive: true }]) {
    const db = { auth: { getUser: async () => ({ data: { user: options.loggedOut ? null : { id: 'user' } } }) },
      from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { role: options.role ?? 'operador', is_active: !options.inactive } }) }; } };
    const actions = load('../src/app/expedicao/label-actions.ts', {
      'next/cache': { revalidatePath() {} }, '@/lib/supabase/server': { createSupabaseServerClient: async () => db },
      '@/lib/supabase/admin': { createSupabaseAdminClient() { assert.fail('Sem autorização'); } },
      '@/lib/omie/client': { callOmie() { assert.fail('Sem autorização'); } },
      '@/lib/omie/shipping-invoice': fiscal, '@/lib/omie/label-download': download, '@/lib/omie/shipping-label-pdf': pdf,
      '@/lib/omie/generate-shipping-label': generation, '@/lib/omie/freight-selection': { isMiniEnviosName: () => true },
    });
    const result = await actions.generateShippingLabelAction('11111111-1111-4111-8111-111111111111', options.confirmed !== false);
    assert.equal(result.status, 'error');
  }
});

test('fluxo completo salva original e PDF combinado, confirma NF local e reimprime sem nova geração', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const row = { id, status: 'billing_pending', omie_order_id: 1 };
  const shipment = { label_generation_state: 'none', label_source_urls: null, label_invoice_key: null, label_storage_path: null, package_count: 1, service_code: '04227', carrier_id: '2757271756' };
  const savedInvoice = {};
  const blobs = new Map();
  const operations = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) },
    from(table) {
      let patch; const filters = [];
      const target = table === 'shipments' ? shipment : table === 'fulfillments' ? row : savedInvoice;
      function apply() {
        if (patch && filters.every(([key, value]) => key === 'fulfillment_id' || key === 'id' || target[key] === value)) Object.assign(target, patch);
        return { error: null };
      }
      const q = { select() { return q; }, eq(key, value) { filters.push([key, value]); return q; }, in() { return q; },
        update(value) { patch = value; return q; },
        async upsert(value) { if (table === 'invoices') Object.assign(savedInvoice, value); return { error: null }; },
        async insert() { return { error: null }; },
        async maybeSingle() { if (table === 'user_profiles') return { data: { is_active: true, role: 'operador' } }; if (patch) { apply(); return { data: { id: 'shipment' } }; } return { data: target }; },
        async single() { return { data: target }; }, then(resolve) { return Promise.resolve(apply()).then(resolve); },
      }; return q;
    },
  };
  const bucket = {
    async download(path) { return { data: blobs.has(path) ? new Blob([blobs.get(path)]) : null }; },
    async upload(path, bytes) { blobs.set(path, bytes); return { error: null }; },
  };
  db.storage = { from(name) { assert.equal(name, 'shipping-labels'); return bucket; } };
  const source = await sampleLabel();
  const actions = load('../src/app/expedicao/label-actions.ts', {
    'next/cache': { revalidatePath() {} }, '@/lib/supabase/server': { createSupabaseServerClient: async () => db },
    '@/lib/supabase/admin': { createSupabaseAdminClient() { assert.fail('Expedição deve usar a sessão do operador, sem chave administrativa'); } },
    '@/lib/omie/client': { async callOmie(endpoint, method) { operations.push(method); assert.equal(method, 'GerarEtiqueta'); return { cCodStatus: '0', listaEtiqueta: [{ cUrlEtiqueta: 'https://cdn.omie.com.br/label.pdf' }] }; } },
    '@/lib/omie/shipping-invoice': { readShippingInvoice: async () => invoice },
    '@/lib/omie/label-download': { downloadOmieLabel: async () => source }, '@/lib/omie/shipping-label-pdf': pdf,
    '@/lib/omie/generate-shipping-label': generation, '@/lib/omie/freight-selection': { isMiniEnviosName: () => false },
  });
  const first = await actions.generateShippingLabelAction(id, true);
  assert.equal(first.status, 'success', first.message);
  assert.equal(first.url, `/api/expedicao/${id}/etiqueta`);
  assert.equal(shipment.label_generation_state, 'ready'); assert.equal(row.status, 'label_ready');
  assert.equal(savedInvoice.access_key, key); assert.equal(savedInvoice.status, '006');
  assert.equal(blobs.size, 2);
  assert.equal((await actions.generateShippingLabelAction(id, true)).status, 'success');
  assert.deepEqual(operations, ['GerarEtiqueta']);
});

test('download usa Storage autenticado e exige sessão, NF consistente e caminho do pedido', async () => {
  for (const options of [{}, { loggedOut: true }, { wrongKey: true }, { cancelled: true }]) {
    let downloads = 0;
    const id = '11111111-1111-4111-8111-111111111111';
    const db = {
      auth: { getUser: async () => ({ data: { user: options.loggedOut ? null : { id: 'user' } } }) },
      from(table) {
        const values = {
          user_profiles: { is_active: true },
          shipments: { label_storage_path: `${id}/${key}/etiqueta-nfe-v1.pdf`, label_invoice_key: key, label_generation_state: 'ready' },
          invoices: { access_key: options.wrongKey ? 'other' : key, status: '006' },
          fulfillments: { status: options.cancelled ? 'cancelled' : 'label_ready' },
        };
        return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: values[table] }) };
      },
      storage: { from(name) { assert.equal(name, 'shipping-labels'); return { async download() { downloads++; return { data: new Blob(['%PDF-demo']) }; } }; } },
    };
    const route = load('../src/app/api/expedicao/[id]/etiqueta/route.ts', { '@/lib/supabase/server': { createSupabaseServerClient: async () => db } });
    const response = await route.GET(new Request('https://example.test/label'), { params: Promise.resolve({ id }) });
    assert.equal(response.status, options.loggedOut ? 401 : options.wrongKey || options.cancelled ? 409 : 200);
    assert.equal(downloads, response.status === 200 ? 1 : 0);
    if (response.status === 200) assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});
