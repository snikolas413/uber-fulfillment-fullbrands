import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readSheet } from 'read-excel-file/node';
import { zipSync, strToU8 } from 'fflate';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../src/lib/recipient-import.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const importTools = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const { IMPORT_COLUMNS, MAX_IMPORT_ROWS, parseDelimited, rowsFromCells, validateImportRow, buildImportReport, importReportCsv, normalizeImportRow } = importTools;
const addressTools = {};
new Function('require','exports',ts.transpileModule(readFileSync(new URL('../src/lib/import-address.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(() => importTools,addressTools);
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

test('importação completa CPF de 10 dígitos antes de validar e cadastrar', async () => {
  const { action, saved } = actionWithDatabase();
  for (const cpf of ['1234567890', 1234567890, '123.456.789-0']) {
    const [row] = rowsFromCells([IMPORT_COLUMNS, [cpf, ...values.slice(1)]]);
    assert.equal(row.cpf, '01234567890');
    assert.deepEqual(validateImportRow(row), []);
  }
  const csv = [IMPORT_COLUMNS.join(';'), ['1234567890', ...values.slice(1)].join(';')].join('\n');
  const [row] = rowsFromCells(parseDelimited(csv));
  const results = await action([row, { ...row, line: 3, cpf: values[0] }]);
  assert.deepEqual(results.map(result => result.status), ['created', 'skipped']);
  assert.equal(saved[0].p_document_number, '01234567890');
});

test('importação preserva CPF de 11 dígitos e rejeita outros tamanhos sem completar', () => {
  for (const cpf of ['', '123456789', '123456789012', '12345678901234', '01234567890', '12345678901']) {
    const [row] = rowsFromCells([IMPORT_COLUMNS, [cpf, ...values.slice(1)]]);
    assert.equal(row.cpf, cpf);
    assert.equal(validateImportRow(row).some(error => error.startsWith('CPF')), cpf.length !== 11);
  }
});

test('cabeçalhos acentuados são aceitos; faltas, repetições e excesso de linhas são rejeitados', () => {
  assert.equal(rowsFromCells([IMPORT_COLUMNS.map(key => key === 'endereco' ? 'Endereço' : key === 'codigo_postal' ? 'Código Postal' : key), values]).length, 1);
  assert.throws(() => rowsFromCells([['cpf'], ['123']]), /ausentes/);
  assert.throws(() => rowsFromCells([[...IMPORT_COLUMNS, 'cpf'], values]), /repetidas/);
  assert.equal(rowsFromCells([IMPORT_COLUMNS, ...Array(MAX_IMPORT_ROWS).fill(values)]).length,5000);
  assert.throws(() => rowsFromCells([IMPORT_COLUMNS, ...Array(MAX_IMPORT_ROWS+1).fill(values)]), /5000/);
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

function actionWithDatabase({ role = 'operador', active = true, user = true, failCpf = '', saveDelay = 0, lookup = async cep=>({cep,logradouro:'Rua Afonso',bairro:'Pinheiros',localidade:'São Paulo',uf:'SP'}) } = {}) {
  const saved = [], documents = new Set(), revalidated = [];
  const stats = {lookups:0,active:0,maximum:0};
  const database = {
    auth: { getUser: async () => ({ data: { user: user ? { id: 'user-1' } : null }, error: null }) },
    from(table) {
      let document;
      const query = {
        select() { return query; },
        eq(key, value) { if (key === 'document_number') document = value; return query; },
        async in(key, values) { assert.equal(table,'recipients');assert.equal(key,'document_number');stats.lookups++;return {data:[...documents].filter(value=>values.includes(value)).map(document_number=>({document_number})),error:null}; },
        async maybeSingle() { return { data: { role, is_active: active }, error: null }; },
        async limit() { assert.equal(table, 'recipients'); return { data: documents.has(document) ? [{ id: 'existing' }] : [], error: null }; },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'save_recipient_with_address');
      stats.active++;stats.maximum=Math.max(stats.maximum,stats.active);
      if(saveDelay) await new Promise(resolve=>setTimeout(resolve,saveDelay));
      stats.active--;
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
    if (name === '@/lib/recipient-import') return importTools;
    if (name === '@/lib/import-address') return addressTools;
    if (name === '@/lib/postal-lookup') return {lookupPostalAddress:lookup};
    throw new Error(`Unexpected module: ${name}`);
  };
  new Function('require', 'exports', code)(require, exports);
  return { action: exports.importRecipientsAction, inspect: exports.inspectImportAddressesAction, saved, revalidated, stats };
}

test('normaliza número marcado, sem número, cidade com UF, nome duplicado e CEP numérico', () => {
  const [base] = rowsFromCells([IMPORT_COLUMNS,values]);
  const row = normalizeImportRow({...base,full_name:'Carlos Torres Carlos Torres',endereco:'Rua Amparo número 105 casa 2',numero:'',complemento:'',cidade:'Rio de Janeiro/RJ',estado:'Rio de Janeiro',codigo_postal:'7792390'});
  assert.equal(row.full_name,'Carlos Torres'); assert.equal(row.endereco,'Rua Amparo');
  assert.equal(row.numero,'105'); assert.equal(row.complemento,'casa 2');
  assert.equal(row.cidade,'Rio de Janeiro'); assert.equal(row.estado,'RJ'); assert.equal(row.codigo_postal,'07792390');
  assert.equal(normalizeImportRow({...base,endereco:'Rua Amparo S/N',numero:''}).numero,'S/N');
  assert.equal(normalizeImportRow({...base,endereco:'Rua 25',numero:''}).numero,'');
  assert.equal(normalizeImportRow({...base,cpf:'1.23456789E+9'}).cpf,'01234567890');
  assert.equal(normalizeImportRow({...base,endereco:'Rua Amparo 105',numero:'105'}).endereco,'Rua Amparo');
  assert.equal(normalizeImportRow(row).complemento,row.complemento);
});

test('separa números com símbolos, letras, barras e travessões sem perder partes ou zeros', () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  for (const [address,number,complement] of [
    ['Rua Afonso, n.º 0012-A, casa 2','0012-A','casa 2'],
    ['Rua Afonso #123/A apto 4','123/A','apto 4'],
    ['Rua Afonso – 123/2, fundos','123/2','fundos'],
    ['Rua Afonso, 123 – B, casa 2','123-B','casa 2'],
    ['Rua Afonso: １２３','123',''],
    ['Rua Afonso nº: 12.345','12.345',''],
    ['Rua Afonso 123 / 2','123/2',''],
    ['Rua Afonso 123-B','123-B',''],
    ['Rua Afonso S / N','S/N',''],
    ['Rua Afonso; 123; casa 2','123','casa 2'],
    ['Rua Afonso • 123 • casa 2','123','casa 2'],
    ['Rua Afonso Nº123, apto 4','123','apto 4'],
    ['Rua Afonso № 123, casa 2','123','casa 2'],
  ]) {
    const row=normalizeImportRow({...base,endereco:address,numero:'',complemento:''});
    assert.equal(row.endereco,'Rua Afonso',address);
    assert.equal(row.numero,number,address);
    assert.equal(row.complemento,complement,address);
    assert.equal(normalizeImportRow(row).numero,number,address+' (segunda conferência)');
    assert.equal(normalizeImportRow(row).complemento,complement,address+' (complemento preservado)');
  }
  const explicit=normalizeImportRow({...base,endereco:'Rua Afonso nº 0012-A',numero:'n.º 0012 – A',complemento:'Casa 1'});
  assert.equal(explicit.numero,'0012-A');assert.equal(explicit.endereco,'Rua Afonso');
  const conflict=normalizeImportRow({...base,endereco:'Rua Afonso nº 13-A',numero:'15',complemento:''});
  assert.equal(conflict.numero,'15');assert.equal(conflict.endereco,'Rua Afonso nº 13-A');
  for(const address of ['Rua 25','Avenida 9 de Julho','BR 101','Rodovia BR-101 km 15']) {
    const row=normalizeImportRow({...base,endereco:address,numero:'',complemento:''});
    assert.equal(row.numero,'',address);assert.equal(row.endereco,address);
  }
});

test('aceita aliases de cabeçalho e contatos opcionais, mas não inventa número ou contato', () => {
  const [row] = rowsFromCells([['CPF','Nome completo','Endereço','CEP','numero'],['01234567890','Nome Teste','Rua Afonso','05426200','13']]);
  assert.equal(row.email,''); assert.equal(row.phone_number,'');
  assert.equal(row.numero,'13');
  assert.deepEqual(validateImportRow({...row,bairro:'Pinheiros',cidade:'São Paulo',estado:'SP'}),[]);
  assert.equal(normalizeImportRow({...row,numero:'',endereco:'Rua sem identificação'}).numero,'');
});

test('CEP define logradouro e preserva número; município incompatível continua exigindo conferência', async () => {
  const [base] = rowsFromCells([IMPORT_COLUMNS,values]);
  const postal = async()=>({cep:'07792390',logradouro:'Rua Gilberto Carvalho',bairro:'Panorama (Polvilho)',localidade:'Cajamar',uf:'SP'});
  const result = await addressTools.inspectImportAddress({...base,cidade:'Cajamar',estado:'RJ',endereco:'Rua Gilberto Carvalho',bairro:'Panorama (Polvilho)'},postal);
  assert.equal(result.row.estado,'SP'); assert.equal(result.row.numero,'13'); assert.equal(result.reviewRequired,false);
  const ambiguous = await addressTools.inspectImportAddress({...base,cidade:'São Paulo',estado:'SP'},postal);
  assert.equal(ambiguous.row.cidade,'São Paulo'); assert.equal(ambiguous.row.endereco,'Rua Gilberto Carvalho');
  assert.equal(ambiguous.row.numero,base.numero);
  assert.equal(ambiguous.reviewRequired,true); assert.match(ambiguous.warnings.join(' '),/Município divergente/);
});

test('CEP completa bairro e município; CEP inexistente exige revisão e indisponibilidade gera apenas aviso', async () => {
  const [base] = rowsFromCells([IMPORT_COLUMNS,values]);
  const result = await addressTools.inspectImportAddress({...base,bairro:'',cidade:'',estado:'',email:'',phone_number:''},async()=>({cep:base.codigo_postal,logradouro:base.endereco,bairro:'Pinheiros',localidade:'São Paulo',uf:'SP'}));
  assert.equal(result.row.bairro,'Pinheiros'); assert.equal(result.row.cidade,'São Paulo');
  assert.equal(result.reviewRequired,false); assert.ok(result.warnings.length>=2);
  for (const lookup of [async()=>null]) {
    const inspection = await addressTools.inspectImportAddress(base,lookup);
    assert.equal(inspection.reviewRequired,true); assert.equal(inspection.row.numero,base.numero);
    const db = actionWithDatabase({lookup});
    assert.equal((await db.action([base]))[0].status,'error');
    assert.equal((await db.action([{...base,review_confirmed:true}]))[0].status,'created');
  }
  const lookup=async()=>{throw new Error('offline');};
  const inspection=await addressTools.inspectImportAddress(base,lookup);
  assert.equal(inspection.reviewRequired,false);
  assert.match(inspection.warnings.join(' '),/permanece sem conferência/);
  assert.equal((await actionWithDatabase({lookup}).action([base]))[0].status,'created');
});

test('servidor refaz normalização postal e exige confirmação para conflitos sem confiar na prévia', async () => {
  const [base] = rowsFromCells([IMPORT_COLUMNS,values]);
  const db = actionWithDatabase();
  const result = await db.action([{...base,estado:'RJ',email:'',phone_number:''}]);
  assert.equal(result[0].status,'created'); assert.equal(db.saved[0].p_state,'SP');
  assert.equal(db.saved[0].p_email,null); assert.equal(db.saved[0].p_phone,null);
  const conflict=actionWithDatabase();
  const row={...base,endereco:'Rua completamente diferente',cidade:'Curitiba',estado:'PR',normalization_notes:['CEP conferido']};
  assert.equal((await conflict.action([row]))[0].status,'error'); assert.equal(conflict.saved.length,0);
  assert.equal((await conflict.action([{...row,review_confirmed:true}]))[0].status,'created');
  assert.equal(conflict.saved[0].p_street,'Rua Afonso');
  assert.equal(conflict.saved[0].p_number,row.numero);
});

test('exemplo Belo Horizonte separa 837 e condomínio entre parênteses e grava o logradouro do CEP', async () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  const lookup=async()=>({cep:base.codigo_postal,logradouro:'Rua Belo Horizonte',bairro:'Centro',localidade:'São Paulo',uf:'SP'});
  for(const address of [
    'R. Belo Horizonte 837 ( Condomínio Viva a Vida ALEGRIA )',
    'R. Belo Horizonte 837(Condomínio Viva a Vida ALEGRIA)',
    'R. Belo Horizonte, nº 837 ( Condomínio Viva a Vida ALEGRIA )',
  ]) {
    const row={...base,endereco:address,numero:'',complemento:''};
    const result=await addressTools.inspectImportAddress(row,lookup);
    assert.equal(result.row.endereco,'Rua Belo Horizonte',address);
    assert.equal(result.row.numero,'837',address);
    assert.equal(result.row.complemento,'Condomínio Viva a Vida ALEGRIA',address);
    assert.equal(result.reviewRequired,false,address);
    assert.deepEqual(validateImportRow(result.row),[],address);
    const db=actionWithDatabase({lookup});
    assert.equal((await db.action([row]))[0].status,'created');
    assert.equal(db.saved[0].p_street,'Rua Belo Horizonte');
    assert.equal(db.saved[0].p_number,'837');
    assert.equal(db.saved[0].p_complement,'Condomínio Viva a Vida ALEGRIA');
  }
});

test('rua divergente é substituída pela do CEP, preservando número composto e complemento existente', async () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  const lookup=async()=>({cep:base.codigo_postal,logradouro:'Rua Oficial do CEP',bairro:base.bairro,localidade:base.cidade,uf:base.estado});
  const result=await addressTools.inspectImportAddress({...base,endereco:'Rua diferente 0012/A (Condomínio (Torre A)) apto 4',numero:'',complemento:'(Casa 2)'},lookup);
  assert.equal(result.row.endereco,'Rua Oficial do CEP');
  assert.equal(result.row.numero,'0012/A');
  assert.equal(result.row.complemento,'Casa 2 · Condomínio Torre A apto 4');
  assert.equal(result.reviewRequired,false);
  const again=await addressTools.inspectImportAddress(result.row,lookup);
  assert.equal(again.row.complemento,result.row.complemento);
  assert.equal(again.row.numero,result.row.numero);
  const generic=await addressTools.inspectImportAddress({...base,endereco:'Rua diferente'},async()=>({...await lookup(),logradouro:''}));
  assert.equal(generic.row.endereco,'Rua diferente');
});

test('conferência de CEP exige autenticação e limita concorrência a quatro consultas', async () => {
  const [base] = rowsFromCells([IMPORT_COLUMNS,values]);
  let active=0,maximum=0;
  const db=actionWithDatabase({lookup:async()=>{ active++; maximum=Math.max(maximum,active); await new Promise(resolve=>setTimeout(resolve,2));active--;return null; }});
  const rows=Array.from({length:20},(_,i)=>({...base,line:i+2}));
  assert.equal((await db.inspect(rows)).length,20); assert.equal(maximum,4); assert.equal(db.saved.length,0);
  await assert.rejects(actionWithDatabase({role:'consulta'}).inspect(rows));
  await assert.rejects(db.inspect(Array(51).fill(base)),/50 linhas/);
});

test('prévia de 5000 linhas renderiza só a página de 50 linhas, com navegação e progresso', () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  const rows=Array.from({length:5000},(_,i)=>({...base,line:i+2,cpf:String(i).padStart(11,'0')}));
  const inspections=Object.fromEntries(rows.map(row=>[row.line,{row,warnings:[],reviewRequired:false}]));
  let index=0;
  const state=[true,rows,[],'',false,'grande.csv',2,inspections,'Endereços conferidos: 5000 de 5000',false];
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../src/app/destinatarios/recipient-import.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const modules={react:{...React,useState(initial){const actual=React.useState(initial);return [state[index++]??actual[0],actual[1]];}},'react/jsx-runtime':jsxRuntime,'lucide-react':icons,'next/navigation':{useRouter:()=>({refresh(){}})},'@/lib/recipient-import':importTools,'./import-actions':{}};
  new Function('require','exports',code)(name=>modules[name],exports);
  const html=renderToStaticMarkup(React.createElement(exports.RecipientImport,{existingDocuments:[]}));
  assert.equal((html.match(/<tr>/g)||[]).length,51);
  assert.match(html,/Página 2 de 100/); assert.match(html,/Nome, linha 52/);assert.doesNotMatch(html,/Nome, linha 2"/);
  assert.match(html,/5000 linhas e 10 MB/);assert.match(html,/5000 de 5000/);
});

test('servidor bloqueia sessão ausente, perfil inativo, consulta e etapas grandes', async () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  for (const options of [{ user: false }, { active: false }, { role: 'consulta' }]) {
    const { action, saved } = actionWithDatabase(options);
    await assert.rejects(action([row])); assert.equal(saved.length, 0);
  }
  await assert.rejects(actionWithDatabase().action(Array(51).fill(row)), /50 linhas/);
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

test('conferência e gravação preservam número com letras e barra extraído do endereço original', async () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  const db=actionWithDatabase();
  const result=await db.action([{...base,endereco:'Rua Afonso, n.º 0012/A, apto 4',numero:'',complemento:''}]);
  assert.equal(result[0].status,'created');
  assert.equal(db.saved[0].p_street,'Rua Afonso');
  assert.equal(db.saved[0].p_number,'0012/A');
  assert.equal(db.saved[0].p_complement,'apto 4');
});

test('servidor revalida campos e continua após erro de uma linha', async () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  const { action, saved } = actionWithDatabase({ failCpf: row.cpf });
  const results = await action([row, { ...row, line: 3, cpf: '12345678901' }, { ...row, line: 4, cpf: '123' }]);
  assert.deepEqual(results.map(result => result.status), ['error', 'created', 'error']);
  assert.equal(saved.length, 1);
});

test('bairro alternativo e abreviações não pedem revisão; conflitos de rua e cidade continuam separados', async () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  const lookup=async()=>({cep:base.codigo_postal,logradouro:'Rua Doutor Afonso',bairro:'Jardim Pinheiros',localidade:'São Paulo',uf:'SP'});
  const compatible=await addressTools.inspectImportAddress({...base,endereco:'R. Dr. Afonso',bairro:'Pinheiros'},lookup);
  assert.equal(compatible.reviewRequired,false);
  assert.equal(compatible.row.bairro,'Pinheiros');
  assert.match(compatible.warnings.join(' '),/Bairro informado preservado/);
  const conflict=await addressTools.inspectImportAddress({...base,endereco:'Rua completamente diferente',cidade:'Cajamar'},lookup);
  assert.equal(conflict.reviewRequired,true);
  const wrongState=await addressTools.inspectImportAddress({...base,endereco:'R. Dr. Afonso',cidade:'Curitiba',estado:'PR'},lookup);
  assert.equal(wrongState.reviewRequired,true);
  assert.equal(wrongState.row.cidade,'Curitiba');
  const longName=await addressTools.inspectImportAddress({...base,endereco:'R. Dr. Afonso',full_name:'Nome '.repeat(14).trim()},lookup);
  assert.equal(longName.reviewRequired,false);
});

test('50 linhas usam uma consulta de CPFs e no máximo quatro gravações simultâneas, preservando ordem', async () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  const db=actionWithDatabase({saveDelay:2});
  const rows=Array.from({length:50},(_,i)=>({...base,line:i+2,cpf:String(i).padStart(11,'0')}));
  const results=await db.action(rows);
  assert.equal(db.stats.lookups,1);
  assert.equal(db.stats.maximum,4);
  assert.equal(db.saved.length,50);
  assert.deepEqual(results.map(item=>item.line),rows.map(item=>item.line));
  assert.ok(results.every(item=>item.status==='created'));
  assert.equal((await db.action(rows))[0].status,'skipped');
  assert.equal(db.saved.length,50);
});

test('prévia separa linhas prontas das pendências e só mostra confirmação manual para conflito real', () => {
  const [base]=rowsFromCells([IMPORT_COLUMNS,values]);
  const rows=[base,{...base,line:3,cpf:'12345678901'},{...base,line:4,cpf:'23456789012'}];
  const inspections={2:{row:base,warnings:['Consulta temporariamente indisponível'],reviewRequired:false},3:{row:rows[1],warnings:['Rua divergente'],issues:['Rua divergente'],reviewRequired:true}};
  function render(filter) {
    let index=0;
    const state=[true,rows,[],'',false,'arquivo.csv',1,inspections,'',false,filter];
    const exports={};
    const code=ts.transpileModule(readFileSync(new URL('../src/app/destinatarios/recipient-import.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const modules={react:{...React,useState(initial){const actual=React.useState(initial);return [state[index++]??actual[0],actual[1]];}},'react/jsx-runtime':jsxRuntime,'lucide-react':icons,'next/navigation':{useRouter:()=>({refresh(){}})},'@/lib/recipient-import':importTools,'./import-actions':{}};
    new Function('require','exports',code)(name=>modules[name],exports);
    return renderToStaticMarkup(React.createElement(exports.RecipientImport,{existingDocuments:[]}));
  }
  const ready=render('ready');
  assert.match(ready,/Nome, linha 2/);assert.doesNotMatch(ready,/Nome, linha 3/);
  assert.doesNotMatch(ready,/type="checkbox"/);
  assert.match(ready,/<td class="import-result">Pronto para importar<\/td>/);
  assert.doesNotMatch(ready,/Ver ajustes e avisos/);
  assert.doesNotMatch(ready,/Consulta temporariamente indisponível/);
  const issues=render('issues');
  assert.doesNotMatch(issues,/Nome, linha 2/);assert.match(issues,/Nome, linha 3/);
  assert.match(issues,/Nome, linha 4/);assert.match(issues,/Conferir endereço/);
  assert.equal((issues.match(/type="checkbox"/g)||[]).length,1);
});

test('relatório inclui CPF curto e exclui o registro cadastrado, mesmo após atualizar a listagem', () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  const rows = [{ ...row, cpf: '1234567890' }, { ...row, line: 3 }];
  const validation = [validateImportRow(rows[0]), ['CPF já cadastrado']];
  const report = buildImportReport(rows, validation, [{ line: 3, status: 'created', message: 'Cadastrado' }]);
  assert.equal(report.length, 1); assert.equal(report[0].row.line, 2);
  assert.match(report[0].reason, /11 dígitos/);
  const csv = parseDelimited(importReportCsv(report));
  assert.deepEqual(csv[0], ['linha_arquivo', 'situacao', 'motivo', ...IMPORT_COLUMNS]);
  assert.equal(csv[1][0], '2'); assert.equal(csv[1][3], '1234567890');
  assert.equal(csv[1][7], 'Rua Afonso 13 casa 2');
  assert.equal(csv[1][11], '05426200');
});

test('relatório cobre duplicidades, falhas, resultados desconhecidos e linhas não enviadas', () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  const rows = Array.from({ length: 6 }, (_, index) => ({ ...row, line: index + 2 }));
  const results = ['skipped', 'error', 'unconfirmed', 'not_processed'].map((status, index) => ({ line: index + 2, status, message: 'Motivo ' + index }));
  const report = buildImportReport(rows, [[], [], [], [], ['CPF repetido no arquivo'], []], results);
  assert.equal(report.length, 5);
  assert.deepEqual(report.map(entry => entry.status), ['Ignorado', 'Erro no cadastro', 'Resultado não confirmado', 'Não processado', 'Bloqueado na validação']);
  assert.equal(report[4].reason, 'CPF repetido no arquivo');
  assert.equal(buildImportReport(rows, rows.map(() => []), []).length, 0);
});

test('CSV do relatório preserva aspas, separadores e quebras e neutraliza fórmulas', () => {
  const [row] = rowsFromCells([IMPORT_COLUMNS, values]);
  const csv = importReportCsv([{ row: { ...row, full_name: '=HYPERLINK("url")', bairro: 'Bairro; "A"\nCentro' }, status: 'Erro', reason: 'Motivo; com "aspas"' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  const parsed = parseDelimited(csv);
  assert.equal(parsed[1][4], '\'=HYPERLINK("url")');
  assert.equal(parsed[1][8], 'Bairro; "A"\nCentro');
  assert.equal(parsed[1][2], 'Motivo; com "aspas"');
});
