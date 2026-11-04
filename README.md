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
- Pedidos: preparação local, um destinatário por pedido, endereço de entrega, Purchase Order, quantidade, valor e e-mail de NF-e copiado para o pedido
- Faturamento: acompanhamento da fila e dados de NF-e em modo somente leitura
- Expedição: acompanhamento de documentos, etiquetas e rastreio em modo somente leitura
- Histórico: consulta de auditoria para perfis admin e gestor

A preparação de pedidos grava um rascunho operacional no Supabase. **Ainda não envia pedidos ao Omie, não emite NF-e e não gera etiquetas dos Correios.**

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
- `OMIE_APP_KEY`
- `OMIE_APP_SECRET`
- `OMIE_APP_HASH`
- `OMIE_API_BASE_URL` (opcional)

As credenciais Omie próprias da aplicação ainda precisam ser configuradas no serviço Render antes de habilitar operações externas. A conexão do Omie disponível no ambiente de desenvolvimento não é herdada pelo app publicado.

## Próximos bloqueios antes de produção
1. Aplicar as migrations pendentes em ambiente de teste Supabase.
2. Validar cadastro, edição, versionamento de endereço e preparação de pedido com a conta admin.
3. Configurar e testar as credenciais Omie server-side.
4. Confirmar preço, etapa inicial, condição de pagamento e cenário fiscal com a área responsável.
5. Validar contrato/serviço dos Correios, geração de etiqueta e tratamento de retorno.
6. Habilitar faturamento e expedição somente depois dos testes integrados.

Não mesclar ou publicar as mudanças deste branch antes da validação do banco e do fluxo integrado.
