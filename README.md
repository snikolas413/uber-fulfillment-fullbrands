# Uber Fulfillment | SuppleyTech · FULL BRANDS

Aplicação interna para cadastro de destinatários, gestão de pedidos, faturamento, expedição e rastreabilidade da operação Uber.

## Acesso ao preview
https://uber-fulfillment-fullbrands.onrender.com

## Tecnologia
- Next.js 16 + React + TypeScript
- PostgreSQL gerenciado pelo Supabase (projeto independente pendente de nova organização)
- API Omie exclusivamente no backend
- Render para hospedagem

## Executar localmente
```bash
cp .env.example .env.local
npm install
npm run dev
```

## Módulos
- Dashboard operacional
- Cadastro manual de destinatários e endereços
- Preparação e acompanhamento de pedidos
- Faturamento em lote com prévia e confirmação
- Etiquetas, documentos fiscais e expedição
- Histórico e auditoria

## Segurança e estado atual
- Credenciais Omie e chave Supabase de serviço apenas no servidor.
- Operações críticas exigem confirmação explícita.
- Timeout em mutações exige conciliação antes de nova tentativa.
- Dados pessoais e documentos fiscais não devem ser gravados no Git.
- O preview público está em modo inicial, sem autenticação e sem conexão de produção.
- **Não cadastrar dados reais de motoristas nem usar o painel para operar pedidos até concluir autenticação, banco dedicado e autorização por usuário.**
- O repositório está público conforme decisão do responsável; não incluir segredos, chaves ou dados pessoais.

## Estrutura
- `src/app`: páginas e rotas de API
- `src/components`: componentes da interface
- `src/lib/omie`: cliente server-side Omie
- `src/lib/supabase`: cliente Supabase server-side
- `supabase/migrations`: estrutura inicial do banco
- `docs`: arquitetura, modelo de dados e identidade visual
- `public/brand`: arquivos oficiais da marca

## Validar
```bash
npm run typecheck
npm run lint
npm run build
```
