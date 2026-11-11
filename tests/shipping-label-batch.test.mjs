import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as pdfLib from 'pdf-lib';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)(name => name in modules ? modules[name] : require(name), exports);
  return exports;
}
const batch = load('../src/lib/omie/shipping-label-batch.ts');
const merger = load('../src/lib/omie/merge-label-pdfs.ts');
const fiscal = load('../src/lib/omie/shipping-invoice.ts');
const composer = load('../src/lib/omie/shipping-label-pdf.ts', { './shipping-invoice': fiscal });
function makeKey(number) {
  const prefix = '4226110000000000000055001' + String(number).padStart(9, '0') + '100000000';
  let sum = 0;
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(prefix[i]) * weight;
  const digit = 11 - sum % 11;
  return prefix + (digit >= 10 ? 0 : digit);
}
const key = makeKey(1234);
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

test('lote processa selecionados sequencialmente, continua após falha e reúne somente confirmados', async () => {
  const calls = [], results = []; let active = false;
  const ready = await batch.runShippingLabelBatch(['a', 'error', 'a', 'last'], {
    async generate(id, confirmed) { assert.equal(confirmed, true); assert.equal(active, false); active = true; await Promise.resolve(); active = false; calls.push(id); if (id === 'error') throw new Error('Timeout'); return { status: 'success', message: 'Pronta', url: '/label/' + id }; },
    shouldStop: () => false, onStart() {}, onResult(id, result) { results.push([id, result]); },
  });
  assert.deepEqual(calls, ['a', 'error', 'last']); assert.deepEqual(ready, ['a', 'last']);
  assert.equal(results[1][1].status, 'error');
  assert.match(results[1][1].message, /antes de tentar gerar novamente/);
});

test('interrupção conclui o atual; tentativas incertas não são elegíveis e lotes têm limite', async () => {
  let stop = false; const calls = [];
  const options = { async generate(id) { calls.push(id); return { status: 'success', url: '/x', message: 'Pronta' }; }, shouldStop: () => stop, onStart() {}, onResult() { stop = true; } };
  assert.deepEqual(await batch.runShippingLabelBatch(['a', 'b'], options), ['a']);
  for (const state of ['none', 'sources_ready', 'ready']) assert.equal(batch.canPrepareShippingLabel(state), true);
  for (const state of ['processing', 'unknown', 'invalid']) assert.equal(batch.canPrepareShippingLabel(state), false);
  for (const selection of [[], Array.from({ length: 101 }, (_, i) => String(i))]) await assert.rejects(batch.runShippingLabelBatch(selection, options));
});

async function demoLabel(number, volumes) {
  const source = await pdfLib.PDFDocument.create();
  for (let i = 0; i < volumes; i++) {
    const page = source.addPage([100 * 72 / 25.4, 120 * 72 / 25.4]);
    page.drawText('DEMONSTRACAO - SEM VALOR POSTAL', { x: 12, y: 300, size: 9 });
    page.drawText(`Pedido ${number} - Volume ${i + 1}/${volumes}`, { x: 12, y: 270, size: 12 });
  }
  return composer.composeShippingLabel([await source.save()], { key: makeKey(number), number: String(number), series: '001', issuedDate: '11/11/2026', orderNumber: String(number) }, volumes);
}

test('PDF do lote preserva uma página 100x150 por volume, em ordem, e rejeita formatos/tamanhos incorretos', async () => {
  const files = [await demoLabel(1234, 1), await demoLabel(1235, 2)];
  const bytes = await merger.mergeLabelPdfs(files);
  const result = await pdfLib.PDFDocument.load(bytes);
  assert.equal(result.getPageCount(), 3);
  for (const page of result.getPages()) { assert.ok(Math.abs(page.getWidth() - 100 * 72 / 25.4) < .001); assert.ok(Math.abs(page.getHeight() - 150 * 72 / 25.4) < .001); }
  assert.equal(result.catalog.getOrCreateViewerPreferences().getPrintScaling(), pdfLib.PrintScaling.None);
  const a4 = await pdfLib.PDFDocument.create(); a4.addPage([595, 842]);
  await assert.rejects(merger.mergeLabelPdfs([await a4.save()]), /100 × 150/);
  await assert.rejects(merger.mergeLabelPdfs([]));
  await assert.rejects(merger.mergeLabelPdfs([new Uint8Array(merger.MAX_BATCH_BYTES + 1)]), /20 MB/);
  mkdirSync(new URL('../outputs/labels/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../outputs/labels/demonstracao-lote.pdf', import.meta.url), bytes);
});

test('endpoint do PDF exige sessão, origem, vínculo fiscal e todos os pedidos; reimpressão não chama Omie', async () => {
  const bytes = await demoLabel(1234, 1);
  for (const options of [{}, { proxy: true }, { loggedOut: true }, { inactive: true }, { wrongOrigin: true }, { missing: true }, { wrongKey: true }, { cancelled: true }, { unknown: true }, { invalidInput: true }]) {
    const downloaded = [];
    const db = {
      auth: { getUser: async () => ({ data: { user: options.loggedOut ? null : { id: 'user' } } }) },
      from(table) {
        return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { is_active: !options.inactive } }),
          async in() { assert.equal(table, 'fulfillments'); return { data: options.missing ? [] : ids.map(id => ({ id, status: options.cancelled ? 'cancelled' : 'label_ready', shipments: [{ label_generation_state: options.unknown ? 'unknown' : 'ready', label_invoice_key: key, label_storage_path: `${id}/${key}/etiqueta-nfe-v1.pdf` }], invoices: [{ status: '006', access_key: options.wrongKey ? 'wrong' : key }] })) }; },
        };
      },
      storage: { from() { return { async download(path) { downloaded.push(path); return { data: new Blob([bytes]) }; } }; } },
    };
    const route = load('../src/app/api/expedicao/etiquetas/route.ts', { '@/lib/supabase/server': { createSupabaseServerClient: async () => db }, '@/lib/omie/merge-label-pdfs': merger, '@/lib/omie/shipping-invoice': fiscal });
    const request = new Request(options.proxy ? 'http://localhost:10000/api/expedicao/etiquetas' : 'https://example.test/api/expedicao/etiquetas', { method: 'POST', headers: { host: 'example.test', origin: options.wrongOrigin ? 'https://evil.test' : 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ ids: options.invalidInput ? ['bad'] : [...ids].reverse() }) });
    const response = await route.POST(request);
    assert.equal(response.status, options.wrongOrigin || options.inactive || options.missing ? 403 : options.loggedOut ? 401 : options.invalidInput ? 400 : options.wrongKey || options.cancelled || options.unknown ? 409 : 200);
    if (response.status === 200) { assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(downloaded.map(path => path.split('/')[0]), [...ids].reverse()); assert.equal((await pdfLib.PDFDocument.load(await response.arrayBuffer())).getPageCount(), 2); }
    else assert.equal(downloaded.length, 0);
  }
});

test('tela oferece seleção para operação, bloqueia etiqueta incerta e não gera ao renderizar', () => {
  const { ShippingManagement } = load('../src/app/expedicao/shipping-management.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/components/omie-action-button': { OmieActionButton: () => null }, './label-button': { LabelButton: () => null },
    './label-actions': { generateShippingLabelAction() { assert.fail('Renderização não pode gerar etiqueta'); } },
    '@/lib/omie/shipping-label-batch': batch,
  });
  const rows = ['none', 'ready', 'unknown'].map((state, i) => ({ id: String(i), status: 'billed', created_at: '2026-11-11', recipients: { full_name: `Pessoa ${i}` }, shipments: { label_generation_state: state, label_storage_path: state === 'ready' ? '/saved.pdf' : null }, invoices: null }));
  const render = canGenerate => renderToStaticMarkup(React.createElement(ShippingManagement, { rows, canGenerate, loadError: false }));
  const html = render(true);
  assert.match(html, /Preparar etiquetas selecionadas/);
  assert.match(html, /aria-label="Selecionar envio de Pessoa 2"[^>]*disabled/);
  assert.ok(!render(false).includes('type="checkbox"'));
});
