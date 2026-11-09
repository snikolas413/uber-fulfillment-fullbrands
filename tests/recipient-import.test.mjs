import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readSheet } from 'read-excel-file/node';
import { zipSync, strToU8 } from 'fflate';

const source = readFileSync(new URL('../src/lib/recipient-import.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { IMPORT_COLUMNS, parseDelimited, rowsFromCells, validateImportRow } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const values = ['01234567890', 'Teste Full', '551198765280', 'testefull@gmail.com', 'Rua Afonso 13 casa 2', 'Pinheiros', 'São Paulo', 'SP', '05426200'];

test('estrutura do exemplo separa rua, número e complemento e preserva zeros', () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  assert.equal(row.endereco, 'Rua Afonso');
  assert.equal(row.numero, '13');
  assert.equal(row.complemento, 'casa 2');
  assert.equal(row.cpf, '01234567890');
  assert.equal(row.codigo_postal, '05426200');
  assert.deepEqual(validateImportRow(row), []);
});

test('CSV aceita BOM, ponto e vírgula, aspas escapadas e células multilinha', () => {
  assert.deepEqual(parseDelimited('\uFEFFa;b\r\n"Rua; A";"casa ""2""\nfundos"\r\n'), [['a', 'b'], ['Rua; A', 'casa "2"\nfundos']]);
  assert.deepEqual(parseDelimited('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseDelimited('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.throws(() => parseDelimited('a;b\n"ab;c'), /aspas abertas/);
});

test('cabeçalhos acentuados são aceitos; faltas, repetições e excesso de linhas são rejeitados', () => {
  assert.equal(rowsFromCells([IMPORT_COLUMNS.map(key => key === 'endereco' ? 'Endereço' : key === 'codigo_postal' ? 'Código Postal' : key), values]).length, 1);
  assert.throws(() => rowsFromCells([['cpf'], ['123']]), /ausentes/);
  assert.throws(() => rowsFromCells([[...IMPORT_COLUMNS, 'cpf'], values]), /repetidas/);
  assert.throws(() => rowsFromCells([IMPORT_COLUMNS, ...Array(501).fill(values)]), /500/);
  assert.throws(() => rowsFromCells([IMPORT_COLUMNS, [...values, 'extra']]), /mais campos/);
});

test('rua com nome numérico e colunas explícitas de endereço', () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values.map((value, i) => i === 4 ? 'Rua 25 de Março 100 apto 3' : value)]);
  assert.equal(row.endereco, 'Rua 25 de Março'); assert.equal(row.numero, '100'); assert.equal(row.complemento, 'apto 3');
  const [explicit] = rowsFromCells([[...IMPORT_COLUMNS, 'numero', 'complemento'], [...values.slice(0, 4), 'Rua 25', ...values.slice(5), '10', 'Casa 2']]);
  assert.equal(explicit.endereco, 'Rua 25'); assert.equal(explicit.numero, '10'); assert.equal(explicit.complemento, 'Casa 2');
});

test('endereços ambíguos exigem revisão; CPF/CEP curtos e UF inexistente são bloqueados', () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values.map((value, i) => i === 4 ? 'Rua sem número identificado' : value)]);
  assert.ok(validateImportRow({ ...row, cpf: '123', codigo_postal: '5426200', estado: 'ZZ' }).length >= 4);
});

test('leitura de XLSX real mantém CPF e CEP textuais e usa a primeira aba', async () => {
  const column = index => String.fromCharCode(65 + index);
  const xmlRows = [IMPORT_COLUMNS, values].map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('');
  const archive = zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Destinatarios" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`,
  }).map(([key, value]) => [key, strToU8(value)])));
  const cells = await readSheet(Buffer.from(archive));
  const [row] = rowsFromCells(cells);
  assert.equal(row.cpf, values[0]); assert.equal(row.codigo_postal, values[8]);
  assert.deepEqual(validateImportRow(row), []);
});

function actionWithDatabase({ role = 'operador', active = true, user = true, failCpf = '' } = {}) {
  const saved = [], documents = new Set(), revalidated = [];
  const database = {
    auth: { getUser: async () => ({ data: { user: user ? { id: 'user-1' } : null }, error: null }) },
    from(table) {
      let document;
      const query = {
        select() { return query; },
        eq(key, value) { if (key === 'document_number') document = value; return query; },
        async maybeSingle() { return { data: { role, is_active: active }, error: null }; },
        async limit() { assert.equal(table, 'recipients'); return { data: documents.has(document) ? [{ id: 'existing' }] : [], error: null }; },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'save_recipient_with_address');
      if (args.p_document_number === failCpf) return { error: { message: 'database failure' } };
      saved.push(args); documents.add(args.p_document_number);
      return { data: 'recipient-1', error: null };
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/app/destinatarios/import-actions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const require = name => {
    if (name === 'next/cache') return { revalidatePath: path => revalidated.push(path) };
    if (name === '@/lib/supabase/server') return { createSupabaseServerClient: async () => database };
    if (name === '@/lib/recipient-import') return { validateImportRow };
    throw new Error(`Unexpected module: ${name}`);
  };
  new Function('require', 'exports', code)(require, exports);
  return { action: exports.importRecipientsAction, saved, revalidated };
}

test('servidor bloqueia sessão ausente, perfil inativo, consulta e etapas grandes', async () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  for (const options of [{ user: false }, { active: false }, { role: 'consulta' }]) {
    const { action, saved } = actionWithDatabase(options);
    await assert.rejects(action([row])); assert.equal(saved.length, 0);
  }
  await assert.rejects(actionWithDatabase().action(Array(21).fill(row)), /20 linhas/);
});

test('servidor preserva campos e ignora CPF repetido ou reenviado', async () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  const { action, saved, revalidated } = actionWithDatabase();
  const results = await action([row, { ...row, line: 3 }]);
  assert.deepEqual(results.map(result => result.status), ['created', 'skipped']);
  assert.equal(saved.length, 1); assert.equal(saved[0].p_postal_code, '05426200');
  assert.equal(saved[0].p_number, '13'); assert.equal(saved[0].p_complement, 'casa 2');
  assert.equal((await action([row]))[0].status, 'skipped');
  assert.ok(revalidated.includes('/destinatarios'));
});

test('servidor revalida campos e continua após erro de uma linha', async () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  const { action, saved } = actionWithDatabase({ failCpf: row.cpf });
  const results = await action([row, { ...row, line: 3, cpf: '12345678901' }, { ...row, line: 4, estado: 'ZZ' }]);
  assert.deepEqual(results.map(result => result.status), ['error', 'created', 'error']);
  assert.equal(saved.length, 1);
});
