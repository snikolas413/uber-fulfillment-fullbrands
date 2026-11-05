# Atualização logística do pedido Omie pela API

## Escopo implementado

A tela Expedição oferece uma ação controlada para atualizar, em um pedido já existente, os campos da estrutura `frete` pela operação `AlterarPedidoVenda` do serviço `/api/v1/produtos/pedido/`.

Campos enviados:
- `frete.codigo_transportadora`: código interno do cadastro de transportadora no Omie;
- `frete.especie_volumes`: embalagem / espécie dos volumes (texto livre, até 60 caracteres);
- `frete.quantidade_volumes`: quantidade de volumes;
- `frete.valor_frete`: valor em reais;
- `frete.previsao_entrega`: data em `dd/mm/aaaa`;
- `frete.modalidade`: responsável pelo frete (0 CIF, 1 FOB ou 2 terceiros).

A ação consulta o pedido antes da gravação, exige o código de integração do pedido, bloqueia pedidos cancelados/faturados/enviados, solicita confirmação explícita no formulário e consulta novamente depois para conferir os campos gravados. A atualização não inclui pedido novo, não altera itens/cabeçalho comercial, não fatura e não chama a API dos Correios.

## Fluxo Correios

Cotação e seleção de serviço são operações diferentes da atualização do cadastro de frete. A API Omie disponibiliza `CotarFrete` e `VincularFrete`; a geração do frete/etiqueta ocorre em operação separada (`GerarFrete`). Essas operações não são chamadas por esta implementação. A cotação, contratação, etiqueta e postagem continuam no fluxo Correios dentro do ERP até uma etapa futura, com aprovação operacional própria.

## Observações operacionais

- `especie_volumes` é um campo textual de espécie/embalagem, não um ID de cadastro de embalagem.
- O código da transportadora deve ser o ID interno do cadastro no Omie, não o nome ou CNPJ.
- A modalidade precisa ser confirmada por quem conhece o acordo comercial. Não inferir CIF/FOB a partir do valor do frete.
- A prévia lê os dados atuais do pedido; ela não reserva nem calcula preço de frete.
- A atualização é gravada no ERP real somente após o operador marcar a confirmação e acionar o botão.
- Após a gravação, o sistema salva os dados de frete localmente e registra auditoria sem armazenar dados pessoais do destinatário.
- Não há deploy ou alteração de produção por esta branch.

## Referências oficiais

- Pedido de Vendas de Produtos: https://api.omie.com.br/docs/apis/produtos/pedido
- Frete: https://api.omie.com.br/docs/apis/produtos/frete
