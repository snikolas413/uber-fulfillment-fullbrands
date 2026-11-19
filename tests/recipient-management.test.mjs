import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';

test('base com 1000 destinatários renderiza só 50 linhas e oferece navegação, sem gravações', () => {
  const exports = {};
  const modules = {
    react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
    'next/link': {default:props=>React.createElement('a',props,props.children)},
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    './actions': { saveRecipientAction() { assert.fail('Não pode salvar ao renderizar'); } },
    './recipient-import': { RecipientImport: () => null }, './recipient-export': { RecipientExport: () => null },
    '@/lib/recipient-report': { matchesRecipientSearch: () => true },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/app/destinatarios/recipient-management.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in modules, name); return modules[name]; }, exports);
  const recipients = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), full_name: 'Destinatário ' + i,
    document_number: null, email: null, phone: null, created_at: '2026-11-17T12:00:00Z', delivery_addresses: [] }));
  const html = renderToStaticMarkup(React.createElement(exports.RecipientManagement, { recipients:recipients.slice(0,50),directory:{search:'',page:1,pageCount:20,count:1000,total:1000,validated:0,review:0,documents:[]},canWrite: true }));
  assert.equal((html.match(/class="recipient-row-group"/g) ?? []).length, 50);
  assert.match(html, /Página 1 de 20/);
  assert.match(html, /1000 resultado\(s\) de 1000 destinatário/);
  assert.match(html, /Destinatário 49/);assert.doesNotMatch(html,/Destinatário 50</);
});
