# Uber Fulfillment | SuppleyTech · FULL BRANDS

Aplicação interna para gerenciar o ciclo de atendimento dos destinatários da operação Uber: cadastro, criação de pedido no Omie, faturamento, postagem, documentos de expedição e auditoria.

## Repositório
https://github.com/snikolas413/uber-fulfillment-fullbrands

## Stack inicial
- Next.js 16.4.5 + React 19.3.1 + TypeScript
- PostgreSQL via Supabase
- Supabase Auth planejado para acesso interno
- API Omie exclusivamente no backend
- Render como opção de hospedagem

## Executar localmente
```bash
cp .env.example .env.local
npm install
npm run dev
```
Acesse http://localhost:3000. O dashboard inicial usa indicadores zerados e não consulta nem altera dados de produção.

## Escopo
1. Cadastro manual e validação de destinatários e endereços.
2. Criação de um pedido Omie por destinatário, uma unidade de REMOTE BUTTON (R18).
3. Transportadora, serviço, embalagem e frete conforme dados efetivos do Omie.
4. Faturamento em lote com prévia, confirmação e resultado por pedido.
5. Etiqueta de postagem, dados de NF-e/DANFE e PDF combinado.
6. Histórico, rastreabilidade e auditoria ponta a ponta.

## Referências Omie levantadas
- Empresa: FULL SERVICE TRADING LTDA. O app_hash permanece apenas no servidor.
- Cliente: UBER DO BRASIL TECNOLOGIA LTDA.
- Produto: REMOTE BUTTON, código R18.
- Pedido 1107: referência comercial histórica, cancelado em 29/10/2026. Não reutilizar nem alterar.
- Pedido 1122: referência operacional já faturada. Transportadora identificada: 2757271756.
- A modalidade de frete 9 não deve ser interpretada como serviço comercial Mini Envios.
- Embalagem e código Mini Envios precisam ser confirmados nos cadastros/API do Omie.

Os dados fiscais dos pedidos históricos não devem ser copiados cegamente. O cenário tributário deve ser validado por destinatário/operação.

## Segurança operacional
- Credenciais Omie e SUPABASE_SERVICE_ROLE_KEY somente no backend.
- Nenhuma criação, alteração, faturamento, cancelamento ou geração de frete real sem ação explícita do operador.
- Operações em lote com prévia, seleção exata e confirmação.
- codigo_pedido_integracao determinístico e único por operação.
- Timeout exige conciliação no Omie antes de nova tentativa.
- Não refaturar automaticamente operações de resultado desconhecido.
- Trilha de auditoria sem segredos e com dados pessoais minimizados.

## Estrutura
- src/app: páginas e rotas de API.
- src/components: interface.
- src/lib/omie: cliente server-side Omie.
- src/lib/supabase: cliente Supabase server-side.
- supabase/migrations: schema inicial.
- docs: arquitetura, dados, identidade e integração.
- public/brand: arquivos oficiais da marca.

## Estado
- [x] Repositório GitHub conectado.
- [x] Marca oficial recebida e adicionada.
- [x] Dashboard inicial e navegação responsiva.
- [x] Estrutura Next.js, TypeScript, Supabase e Omie.
- [x] Migration SQL e documentação.
- [ ] Revisão visual fina com o site de referência.
- [ ] Autenticação e autorização interna.
- [ ] Aplicar migration no Supabase desta aplicação.
- [ ] Configurar credenciais Omie no ambiente seguro.
- [ ] Implementar e validar consultas, pedidos, faturamento, frete e documentos.
- [ ] Configurar hospedagem e domínio no Render.

## Validar
```bash
npm run typecheck
npm run lint
npm run build
```
