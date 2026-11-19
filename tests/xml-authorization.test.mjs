import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, modules = {}) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => name in modules ? modules[name] : require(name), exports);
  return exports;
}
const authorization = load('../src/lib/omie/xml-authorization.ts');
const fiscal = load('../src/lib/omie/shipping-invoice.ts', { './xml-authorization': authorization });
const key = '42261141244775000190550010000013031053506334';
const expected = { key, protocol: '242260558076422', number: '1303', series: '001', issuedDate: '18/11/2026' };
const xml = () => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><tpAmb>1</tpAmb><mod>55</mod><tpNF>1</tpNF><nNF>1303</nNF><serie>1</serie><dhEmi>2026-11-18T15:26:50-03:00</dhEmi></ide></infNFe></NFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>${key}</chNFe><nProt>${expected.protocol}</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test('XML exige autorização 100 de produção, chave, protocolo, modelo, saída, número, série e data correspondentes', () => {
  authorization.assertXmlAuthorization(xml(), expected);
  for (const bad of [
    xml().replace('<cStat>100', '<cStat>101'), xml().replace('<cStat>100', '<cStat>110'),
    xml().replaceAll('<tpAmb>1', '<tpAmb>2'), xml().replace('<mod>55', '<mod>65'),
    xml().replace('<tpNF>1', '<tpNF>0'), xml().replace('<nNF>1303', '<nNF>1304'),
    xml().replace('<serie>1', '<serie>2'), xml().replace('<dhEmi>2026-11-18', '<dhEmi>2026-11-19'),
    xml().replace('NFe' + key, 'NFe' + '1'.repeat(44)), xml().replace(`<chNFe>${key}`, '<chNFe>' + '1'.repeat(44)),
    xml().replace(expected.protocol, '242260558076423'), xml().replace('<cStat>100</cStat>', '<cStat>100</cStat><cStat>101</cStat>'),
    xml().replace('<NFe>', '<wrapper><NFe>').replace('</NFe>', '</NFe></wrapper>'),
    xml().replace('</nfeProc>', '<infEvento><tpEvento>110111</tpEvento></infEvento></nfeProc>'),
    '<!DOCTYPE nfeProc [<!ENTITY injected "100">]>' + xml(), xml().replace('<cStat>100', '<cStat>&injected;'),
    xml().replace('</protNFe>', ''), xml() + xml(), 'x'.repeat(2 * 1024 * 1024 + 1),
  ]) assert.throws(() => authorization.assertXmlAuthorization(bad, expected));
  assert.throws(() => authorization.assertXmlAuthorization(xml(), { ...expected, protocol: '1' }));
});

test('download do XML restringe HTTPS e domínio Omie, tamanho, redirecionamento e resposta', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(xml()); };
    for (const url of ['http://cdn.omie.com.br/nf.xml', 'https://evil.test/nf.xml', 'https://user:pass@cdn.omie.com.br/nf.xml']) {
      await assert.rejects(authorization.verifyOmieXmlAuthorization(url, expected));
    }
    assert.equal(calls, 0);
    await authorization.verifyOmieXmlAuthorization('https://cdn.omie.com.br/nf.xml', expected);
    assert.equal(calls, 1);
    for (const response of [new Response('Bad gateway', { status: 502 }),
      new Response(xml(), { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
      new Response(null, { status: 302, headers: { location: 'https://evil.test/nf.xml' } }),
      new Response('<html>Login</html>'), new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(authorization.verifyOmieXmlAuthorization('https://cdn.omie.com.br/nf.xml', expected));
    }
  } finally { globalThis.fetch = original; }
});

test('status 036 só passa para a etiqueta após ConsultarNF e XML; divergência não gera qualquer operação', async () => {
  const original = globalThis.fetch;
  try {
    let downloads = 0;
    globalThis.fetch = async () => { downloads++; return new Response(xml()); };
    const note = { chave_nfe: key, numero_nfe: '1303', serie_nfe: '001', tipo: 'S', protocolo: expected.protocol, status_nfe: '036', xml_distr: 'https://cdn.omie.com.br/nf.xml' };
    const snapshot = { codigo_pedido: 123, codigo_pedido_integracao: 'local', cancelada: 'N', faturada: 'S', ListaNfe: [note] };
    const calls = [];
    const request = async (endpoint, method) => {
      calls.push(method);
      if (method === 'StatusPedido') return snapshot;
      assert.equal(method, 'ConsultarNF');
      return { compl: { cChaveNFe: key, nIdPedido: 123 }, ide: { nNF: '1303', serie: '001', dEmi: '18/11/2026', cDeneg: 'N', mod: '55', tpNF: '1' } };
    };
    const result = await fiscal.readShippingInvoice(request, 123, 'local');
    assert.equal(result.authorizationSource, 'xml'); assert.equal(result.omieStatus, '036');
    assert.deepEqual(calls, ['StatusPedido', 'ConsultarNF']); assert.equal(downloads, 1);
    snapshot.ListaNfe.push({ ...note, status_nfe: '006' });
    await assert.rejects(fiscal.readShippingInvoice(request, 123, 'local'));
    snapshot.ListaNfe.pop(); note.protocolo = '242260558076423';
    await assert.rejects(fiscal.readShippingInvoice(request, 123, 'local'));
    note.protocolo = expected.protocol; delete note.xml_distr;
    await assert.rejects(fiscal.readShippingInvoice(request, 123, 'local'));
    assert.ok(!calls.some(method => /Faturar|Gerar/.test(method)));
  } finally { globalThis.fetch = original; }
});
