# Modelo de dados

## Cadastros
- `recipients`: dados de identificação e contato do destinatário/motorista.
- `delivery_addresses`: versões de endereço relacionadas a cada destinatário. Um pedido referencia uma versão específica, preservando o destino originalmente informado.

## Operação
- `fulfillments`: uma preparação por destinatário, status operacional, chave de idempotência, referências ao pedido Omie, cliente, cenário fiscal e Purchase Order.
- `fulfillment_items`: itens da preparação, produto de referência, NCM, CFOP, unidade, quantidade, preço e total calculado.
- `invoices`: número, série, chave de acesso, protocolo e caminhos dos documentos fiscais.
- `shipments`: transportadora, serviço, embalagem, rastreio, etiqueta e frete.
- `integration_events`: correlação, operação, resultado e resumo técnico sem segredos.
- `audit_logs`: ator, ação, entidade, resumo e data.

## Regras de integridade
- `fulfillments.idempotency_key` impede a criação repetida do mesmo rascunho a partir de uma tentativa duplicada.
- A preparação valida se o endereço pertence ao destinatário selecionado.
- O pedido guarda a FK de `delivery_addresses`; alterações futuras no cadastro não mudam endereços já usados.
- `fulfillment_items.line_total` é calculado pelo banco.
- As tabelas públicas mantêm RLS habilitada. O acesso de escrita é por perfis admin, gestor e operador; consulta também pode ser concedida ao perfil consulta conforme as políticas.

## Status de fulfillment
`ready`, `order_pending`, `order_created`, `billing_pending`, `billed`, `shipping_pending`, `label_ready`, `shipped`, `error`, `cancelled`.

A etapa atual grava apenas preparações locais com status `ready`. As transições para pedido Omie, faturamento e expedição dependem de integrações que ainda não foram habilitadas.

Rever políticas de acesso, retenção e tratamento de dados pessoais antes de produção.
