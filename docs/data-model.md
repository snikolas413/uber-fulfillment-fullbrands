# Modelo de dados inicial

- recipients: cadastro de destinatários.
- delivery_addresses: endereços vinculados ao destinatário.
- fulfillments: operação individual, estado local e chave de idempotência.
- invoices: número, série, chave de acesso, protocolo e caminhos dos documentos.
- shipments: transportadora, serviço, embalagem, rastreio e etiqueta.
- integration_events: correlação, operação, resultado e resumo sem segredos.
- audit_logs: ator, ação, entidade e histórico de alterações.

Rever políticas de acesso, retenção e tratamento de dados pessoais antes de produção.
