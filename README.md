# Uber Fulfillment | SuppleyTech · FULL BRANDS

Aplicação interna para gestão da operação de fulfillment da Uber: cadastro de motoristas, preparação de pedidos, faturamento, expedição e rastreabilidade.

## Preview
https://uber-fulfillment-fullbrands.onrender.com

## Tecnologia
- Next.js 16, React 19 e TypeScript
- PostgreSQL/Supabase, autenticação e Row Level Security (RLS)
- Omie ERP, integração exclusivamente server-side
- Render para hospedagem

## Módulos implementados no branch de evolução
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
- `SUPABASE_SERVICE_ROLE_KEY` (somente servidor)
- `OMIE_APP_HASH`
- `OMIE_ACCESS_TOKEN`
- `OMIE_REFRESH_TOKEN`
- `OMIE_ACCESS_TOKEN_ISSUED_AT` (ISO 8601)
- `OMIE_API_BASE_URL` (opcional)

As credenciais Omie próprias da aplicação ainda precisam ser configuradas no serviço Render antes de habilitar operações externas. A conexão do Omie disponível no ambiente de desenvolvimento não é herdada pelo app publicado.

## Próximos bloqueios antes de produção
1. Aplicar as migrations pendentes em ambiente de teste Supabase.
2. Validar cadastro, edição, versionamento de endereço e preparação de pedido com a conta admin.
3. Configurar e testar as credenciais Omie server-side.
4. Configurar credenciais próprias da aplicação Omie no Render.
5. Confirmar os parâmetros fiscais/comerciais e executar um primeiro pedido assistido.
6. Validar sincronização da NF-e e sincronização do frete/rastreio que o Omie já recebeu dos Correios.

Não mesclar ou publicar as mudanças deste branch antes da validação do banco e do fluxo integrado.
