# Separação antes do faturamento

Fluxo: Pedidos → Separação → Faturamento → Expedição.

A criação permanece na etapa inicial, sem emissão. Na tela `/separacao`, o operador
seleciona até 100 pedidos e confirma o envio. A etapa ativa é descoberta pela API
`ListarEtapasFaturamento`: uma única operação de venda de produtos e uma única
coluna ativa com descrição de separação, código 10–40. Configuração ausente ou
ambígua bloqueia o envio; não existe código de coluna presumido.

Cada pedido tem reserva persistente `separation_state`. Antes da troca, são
conferidos vínculo, cancelamento e ausência de NF-e/faturamento em andamento.
`TrocarEtapaPedido` é chamado uma vez e `StatusPedido` confirma o resultado.
Somente essa confirmação grava etapa, data, auditoria e libera o faturamento.
Resultados incertos são consultados por **Conferir no Omie**, sem nova troca.
Se o resultado continuar incerto, confira e ajuste a coluna manualmente no ERP;
a aplicação reconhecerá a etapa na próxima conferência. Uma recusa explícita
mantém o pedido disponível para nova seleção após corrigir o problema.

Erros ficam na linha e no histórico; o lote continua para os próximos pedidos.
A tela deve permanecer aberta durante o lote. Esta ação não chama faturamento,
geração de frete ou etiqueta. As proteções existentes da API continuam ativas.

O servidor e a interface bloqueiam novos faturamentos sem a confirmação de
separação. Antes da emissão, o Omie é reconferido na etapa registrada ou na 50
(caso uma tentativa fiscal anterior já tenha preparado o pedido).
Todas as validações fiscais, de frete e reservas de emissão continuam exigidas.
Pedidos com emissão previamente registrada permanecem visíveis para conferência.

Não há migração automática de pedidos do ERP. Os pedidos antigos ainda não
faturados começam sem confirmação e precisam passar por essa nova tela.
Pedidos faturados, cancelados e etiquetas existentes não são alterados.
