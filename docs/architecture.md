# Arquitetura técnica

## Componentes
- Dashboard: indicadores consultados diretamente no PostgreSQL.
- Destinatários: cadastro, edição, pesquisa e histórico de versões de endereço.
- Pedidos: preparação local com destinatário, endereço, produto, quantidade, preço e Purchase Order.
- Faturamento: acompanhamento da fila e registros de NF-e, atualmente somente leitura.
- Expedição: acompanhamento de endereços, etiquetas e rastreio, atualmente somente leitura.
- Histórico: trilha de auditoria disponível para admin e gestor.
- Configurações: parâmetros, integrações e usuários internos.

## Backend
Next.js Server Components e Server Actions tratam as operações da aplicação. As RPCs de gravação no PostgreSQL usam `SECURITY INVOKER`, verificam autenticação e papel ativo, validam os dados e escrevem eventos de auditoria.

A camada Omie permanece server-side. A preparação local não chama a API. Antes de habilitar escrita externa, cada operação deverá ter chave de integração idempotente, pré-validação, confirmação explícita e reconciliação de timeout.

## Banco
PostgreSQL/Supabase mantém destinatários, endereços versionados, preparações, itens, faturas, envios, eventos de integração e auditoria. O Omie permanece como fonte oficial do pedido de venda, faturamento e documentos fiscais.

## Estado atual das integrações
- Supabase: autenticação admin validada. As migrations novas de destinatários e preparação de pedidos ainda não foram aplicadas ao banco.
- Omie: mapeamento consultado em modo leitura. Credenciais próprias do app e chamadas de escrita ainda não habilitadas.
- Correios: módulo de acompanhamento preparado; geração de etiqueta e rastreamento pela aplicação ainda não habilitados.
