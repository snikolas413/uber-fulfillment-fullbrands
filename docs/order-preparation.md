# Preparação de pedidos Uber

## Escopo da primeira etapa
A aplicação registra uma preparação local por destinatário. A etapa não cria pedido no Omie, não fatura e não gera documentos fiscais ou etiquetas.

## Referência consultada no Omie em 04/11/2026
- Cliente: Uber do Brasil Tecnologia Ltda. (cadastro Omie `codigo_cliente_omie` 2867720329).
- Produto ativo: REMOTE BUTTON, código `R18`, ID `2948561716`.
- Unidade: PC.
- NCM cadastrado: 8517.62.99.
- Valor unitário atual consultado no cadastro de produto: R$ 107,97. O pedido de venda analisado tinha valor negociado diferente; portanto, o valor da tela é apenas uma referência editável.
- Cenário fiscal usado em pedido recente: Venda para entrega futura - 5.117/6.117, ID `2954399884`.
- Pedido recente analisado: pedido 1116, com cliente Uber, item REMOTE BUTTON, quantidade 1 e endereço físico do motorista informado em `informacoes_adicionais.outros_detalhes`.

## Mapeamento observado para integração futura
- Cabeçalho de venda: cliente Uber e cenário fiscal de venda para entrega futura.
- Item: produto R18, quantidade e preço conferidos no momento do envio.
- Endereço físico do motorista: campos de destino como nome, logradouro, número, complemento, bairro, CEP, cidade, UF e telefone.
- Purchase Order Uber: usar como referência de cliente quando disponível.
- Não reaproveitar automaticamente o CFOP, preço, cenário ou condição de pagamento sem validar que continuam aplicáveis ao pedido atual.

## E-mail para o cliente no Omie
- O e-mail do destinatário é carregado automaticamente na preparação do pedido e pode ser ajustado para aquele pedido.
- A aplicação guarda uma cópia do e-mail no próprio pedido local, preservando o contato usado mesmo que o cadastro do destinatário mude depois.
- Na integração, o campo será enviado em `informacoes_adicionais.utilizar_emails`, que corresponde à aba **E-mail para o Cliente** e aceita múltiplos endereços separados por vírgula.
- `informacoes_adicionais.enviar_email` continuará como `N` por padrão. Preencher o destinatário não deve disparar o envio automático de boleto, DANFE ou XML.

## Próximas validações antes de habilitar o envio ao Omie
1. Confirmar se o pedido fica no cliente Uber com endereço do motorista nos dados adicionais, conforme o pedido de referência.
2. Validar etapa inicial e condição de pagamento para inclusão pela API.
3. Confirmar valores, regras fiscais, estoque e tratamento de preço negociado.
4. Implementar chamada Omie com código de integração idempotente e reconciliação em caso de timeout.
5. Executar integração primeiro em um ambiente de testes ou com um pedido expressamente autorizado.


A integração externa permanece bloqueada enquanto essas definições e as credenciais próprias da aplicação não estiverem configuradas e validadas.


## Pré-conferência de faturamento
A fila de faturamento também exibe as preparações locais com status `ready`, incluindo destinatário, Purchase Order, e-mail capturado, item e total. Essa visão é uma etapa de conferência anterior à inclusão no ERP. Não altera status, não cria pedido Omie e não emite NF-e.
