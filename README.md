# Uber Fulfillment | SuppleyTech · FULL BRANDS

Aplicação interna para cadastro de destinatários, gestão de pedidos, faturamento, expedição e rastreabilidade da operação Uber.

## Tecnologia
- Next.js + React + TypeScript
- PostgreSQL gerenciado pelo Supabase
- API Omie exclusivamente no backend
- Render como opção de hospedagem

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

## Segurança
- Credenciais Omie e chave Supabase de serviço apenas no servidor.
- Operações críticas exigem confirmação explícita.
- Timeout em mutações exige conciliação antes de nova tentativa.
- Dados pessoais e documentos fiscais não devem ser gravados no Git.
- Configurações e registros de produção permanecem em serviços seguros fora do repositório.

## Estrutura
- `src/app`: páginas e rotas de API
- `src/components`: componentes da interface
- `src/lib/omie`: cliente server-side Omie
- `src/lib/supabase`: cliente Supabase server-side
- `supabase/migrations`: estrutura inicial do banco
- `docs`: arquitetura, modelo de dados e identidade visual
- `public/brand`: arquivos oficiais da marca

## Estado do projeto
- [x] Repositório GitHub inicializado
- [ ] Integração e autenticação concluídas
- [ ] Banco configurado no ambiente da aplicação
- [ ] Fluxo operacional validado
- [ ] Hospedagem publicada

## Validar
```bash
npm run typecheck
npm run lint
npm run build
```
