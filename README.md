# Uber Fulfillment | SuppleyTech · FULL BRANDS

Aplicação interna para gestão da operação de fulfillment da Uber: cadastro de motoristas, preparação de pedidos, faturamento, expedição e rastreabilidade.

## Produção
https://uber-fulfillment-fullbrands.onrender.com

## Tecnologia
- Next.js 16, React 19 e TypeScript
- PostgreSQL/Supabase, autenticação e Row Level Security (RLS)
- Omie ERP, integração exclusivamente server-side
- Render para hospedagem

## Módulos
- Dashboard com indicadores do banco
- Destinatários: cadastro, edição, busca e histórico de endereços
- Pedidos: preparação local e envio controlado ao Omie, com PO, endereço físico do motorista e e-mail da NF-e
- Faturamento: pré-conferência, sincronização de NF-e e faturamento por ação separada com confirmação
- Expedição: sincronização do frete e rastreio registrados pelo Omie após usar a integração Correios do próprio ERP
- Histórico: consulta de auditoria para perfis admin e gestor

O app se integra ao Omie exclusivamente no servidor. O pedido pode ser criado com ação explícita; faturamento exige confirmação separada. A cotação, etiqueta e postagem são executadas pela integração Correios já configurada no Omie. O app apenas lê os dados resultantes do ERP.

## Executar localmente
```bash
cp .env.example .env.local
npm install
npm run dev
```

## Verificações
GitHub Actions executa automaticamente:
```bash
npm run typecheck
npm run lint
npm run build
```

## Segurança
- Autenticação por e-mail e senha do Supabase.
- Perfis internos e estado de ativação validados no servidor.
- RLS habilitada nas tabelas expostas.
- Operações de gravação usam RPCs `SECURITY INVOKER`, validação do perfil e trilha de auditoria.
- Endereços são versionados: editar o endereço cria nova versão e preserva referências de pedidos existentes.
- Credenciais Omie e chaves Supabase privadas nunca podem ser colocadas em `NEXT_PUBLIC_*` ou no repositório.
- O histórico de auditoria é somente leitura na aplicação.

## Configuração de ambiente
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (somente servidor, necessário para o modo Bearer/Vault)
- `OMIE_APP_KEY` e `OMIE_APP_SECRET` (modo tradicional)
- `OMIE_APP_HASH`, `OMIE_ACCESS_TOKEN`, `OMIE_REFRESH_TOKEN` e `OMIE_ACCESS_TOKEN_ISSUED_AT` (modo Bearer)
- `OMIE_API_BASE_URL` (opcional)
- `APP_BASE_URL` (opcional)

O cliente aceita App Key/Secret no servidor ou token Bearer renovável armazenado no Supabase Vault. Se App Key e App Secret estiverem configurados juntos, o aplicativo usa esse modo tradicional. Não configure os dois modelos ao mesmo tempo sem uma decisão explícita de migração.

## Estado das integrações
- As migrations de e-mail, Vault e metadados foram aplicadas no projeto Supabase conectado em 04/11/2026 e verificadas.
- A integração Correios continua dentro do Omie; este aplicativo não utiliza uma API paralela dos Correios nem depende do webhook para o fluxo atual.
- Ações externas do Omie exigem credenciais próprias da aplicação e validação fiscal/comercial antes do primeiro pedido real.
- Faturamento e expedição devem ser testados de forma assistida. Não execute faturamento real sem conferir o pedido e confirmar a ação.
