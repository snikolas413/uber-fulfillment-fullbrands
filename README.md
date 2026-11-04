# Uber Fulfillment | SuppleyTech · FULL BRANDS

Aplicação interna para cadastro de destinatários, gestão de pedidos, faturamento, expedição e rastreabilidade da operação Uber.

## Acesso ao preview
https://uber-fulfillment-fullbrands.onrender.com

## Tecnologia
- Next.js 16 + React + TypeScript
- PostgreSQL/Supabase com RLS e autenticação
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

## Segurança e acesso
- O aplicativo não oferece cadastro público.
- Cada novo usuário começa inativo e sem acesso até ser aprovado por um administrador.
- Autenticação por e-mail/senha Supabase; sessão validada no proxy do Next.js.
- RLS aplicada em todas as tabelas públicas; papéis: admin, gestor, operador e consulta.
- Credenciais privadas Omie e chaves Supabase secret/service role nunca são enviadas ao navegador.
- Instruções para criar o primeiro administrador: [docs/auth-and-access.md](docs/auth-and-access.md).
- Não cadastrar dados reais até concluir o primeiro administrador e configurar SMTP/URL de recuperação.
- Repositório público conforme decisão do responsável; não incluir segredos, chaves ou dados pessoais.

## Configuração de ambiente
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_APP_HASH`

O identificador da empresa Omie já está configurado no Render; as credenciais de API ainda precisam ser adicionadas pelo responsável.

## Estrutura
- `src/app`: páginas e rotas
- `src/components`: interface
- `src/lib/omie`: cliente server-side Omie
- `src/lib/supabase`: clientes e sessão
- `supabase/migrations`: histórico do schema
- `docs`: arquitetura, dados, identidade e configuração de acesso
- `public/brand`: arquivos oficiais da marca

## Validar
```bash
npm run typecheck
npm run lint
npm run build
```
