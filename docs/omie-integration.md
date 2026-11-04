# Integração Omie

## Princípios
1. Usar credenciais próprias da aplicação, guardadas no ambiente seguro do servidor. A conexão MCP de desenvolvimento não é herdada pela aplicação publicada.
2. Começar por consultas e mapeamento de cadastros.
3. Isolar operações mutáveis e registrar request/response resumidos, sem segredos.
4. Tratar timeout como resultado desconhecido, não como falha confirmada.
5. Nunca faturar automaticamente um pedido sem conferência de elegibilidade, prévia e confirmação do operador.

## Mapeamento consultado em 04/11/2026
- Cliente Uber do Brasil Tecnologia Ltda., ID Omie `2867720329`.
- Produto REMOTE BUTTON, código `R18`, ID Omie `2948561716`.
- Unidade `PC`, NCM `8517.62.99`.
- Valor de catálogo consultado: R$ 107,97. Foi observado ao menos um pedido anterior com valor unitário negociado diferente (R$ 95,54). O sistema exibe o valor de catálogo como referência editável; o preço final precisa ser confirmado pedido a pedido.
- Cenário observado em pedido recente: `Venda para entrega futura - 5.117/6.117`, ID `2954399884`; o item consultado utilizou CFOP `6.117`.

Este mapeamento é referência observada, não autorização para emissão fiscal. Confirmar cenário, CFOP, preço, etapa inicial, condição de pagamento, categoria, conta corrente e regras de entrega antes de criar pedidos em produção.

## Endereço do motorista
Em pedido recente consultado, o cliente do pedido foi Uber e o endereço do motorista foi informado como endereço físico de destino nos campos adicionais do pedido. A integração deverá manter o cliente ERP Uber e transportar o endereço versionado do motorista para os campos de destino apropriados. Não criar um cliente ERP por motorista sem decisão explícita do responsável fiscal.

## E-mail para o cliente
A documentação oficial da API de Pedido de Venda identifica `informacoes_adicionais.utilizar_emails` como a lista de destinatários da Nota Fiscal, apresentada na aba **E-mail para o Cliente**. O sistema deve preencher essa propriedade com o e-mail salvo na preparação local. O campo `enviar_email` é distinto: controla o disparo de boleto/DANFE/XML após faturamento e deve permanecer `N` até haver uma decisão explícita de negócio.

## Operações a implementar e validar
- Consultar cliente, produto, etapa, cenário fiscal e condição de pagamento.
- Consultar transportadoras, modalidades, tipos de entrega, embalagens e serviços.
- Incluir pedido por destinatário, com chave de integração única.
- Consultar imediatamente o resultado da inclusão por chave de integração antes de repetir chamadas em caso de timeout.
- Faturar pedidos individualmente e em lote com confirmação explícita.
- Obter status fiscal, DANFE e XML da NF-e.
- Só então vincular frete, etiqueta e rastreio.

## Faturamento em lote
1. Validar a situação e a elegibilidade de cada pedido.
2. Mostrar a lista exata, preços, destinatários e destino, exigindo confirmação do operador.
3. Executar cada faturamento individualmente, com correlação local.
4. Consultar o status fiscal após a execução.
5. Não refaturar automaticamente resultados incertos.


## Preflight obrigatório antes de incluir pedido
O método `IncluirPedido` exige dados de cabeçalho, etapa, data de previsão, condição de pagamento, informações adicionais e item. A aba de e-mail é alimentada por `informacoes_adicionais.utilizar_emails`. Antes de habilitar a escrita, precisam estar confirmados para a operação atual: etapa inicial, condição de pagamento, categoria, conta corrente, indicador de consumidor final, data prevista, regra de estoque/financeiro e cenário/CFOP. Valores observados em pedidos anteriores servem para comparação, não como autorização nem como padrão definitivo.
