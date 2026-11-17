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

Cotação e seleção de serviço são operações diferentes da atualização do cadastro de frete. A aplicação usa `CotarFrete` e `SelecionarFrete`, pelo ID `nIdFrete` da opção cotada, para selecionar Mini Envios com `lGratis: true` (frete grátis para o cliente). Essa seleção corresponde à opção de entrega acessada pelo botão do caminhão na aba Frete e Outras Despesas. Não usa o cadastro de TiposEntrega nem preenche `codigo_tipo_entrega` para simular essa escolha.

**Enviar ao Omie** executa inclusão e seleção de Mini Envios em sequência, com frete grátis para o cliente. Não muda a etapa do pedido nem solicita faturamento. Se um envio pendente for reconciliado com um pedido já existente e ainda aberto, conclui a etapa de frete sem nova inclusão. A ação **Tentar frete novamente** aparece apenas para pedidos criados com pendência de frete, como recuperação de erro; não faz parte do fluxo normal. A operação confere o vínculo do pedido, a transportadora Correios e uma única opção Mini Envios. Consulta o pedido novamente antes de selecionar e depois da resposta, conferindo que o frete ao cliente ficou zero. A confirmação do serviço escolhido vem da resposta de `SelecionarFrete`; `ConsultarPedido` é usado para conferir os dados disponíveis do pedido.

Consultas de cadastro idênticas usam cache de sucesso de 61 segundos. Consultas frescas do mesmo pedido aguardam essa janela antes de acessar o Omie. `REDUNDANT` e outros erros pausam a integração, sem nova tentativa automática; HTTP 425 pausa por pelo menos 30 minutos. A reserva e a pausa são compartilhadas no Supabase, inclusive entre deploys. O lote para na primeira pendência e mantém os demais pedidos sem envio. Veja [Desempenho e proteção da API](order-preparation.md#desempenho-e-proteção-da-api-omie).

O reconhecimento aceita descrições Mini Envios com os complementos de contrato dos Correios, como `CORREIOS MINI ENVIOS CTR AG` e `MINI ENVIOS CONTRATO TA`. Quando a descrição está vazia, também confere o nome do serviço em `cTipoServico`. Não seleciona PAC, SEDEX, nomes desconhecidos nem uma opção ambígua. Se nenhuma opção for reconhecida, o aviso e a auditoria registram apenas os campos de identificação dos serviços retornados (até 20 opções, com textos limitados), distinguindo esse caso de uma cotação vazia. Não registra credenciais nem o restante da resposta.

Na conferência posterior à seleção aceita com `lGratis: true`, a ausência de `frete.valor_frete` em `ConsultarPedido` equivale a zero. A aplicação ainda exige pedido e transportadora corretos, rejeita valor positivo ou inválido e mantém aviso se a consulta falhar. A omissão de valor por si só não comprova seleção de serviço: é necessária a confirmação anterior de `SelecionarFrete`.

A aplicação não chama `GerarFrete`, `GerarEtiqueta` nem operações de postagem neste fluxo. Se a seleção falhar ou ficar incerta, o pedido continua criado e a pendência aparece na listagem. Não há repetição automática da seleção após timeout. Antes de tentar novamente, confira o pedido no ERP. `lGratis: true` não significa que o serviço dos Correios deixou de ter custo para a empresa.

Erros de `CotarFrete`, inclusive indisponibilidade da transportadora, são devolvidos na primeira resposta. Não há `CancelarCotacao` ou segunda cotação automática. A recuperação depende de nova ação do operador após conferir o ERP e respeitar a pausa.

Para pedidos recém-incluídos, o fluxo reaproveita a transportadora resolvida na inclusão e usa apenas `CotarFrete`, uma `ConsultarPedido` antes da seleção e `SelecionarFrete`. Exige aceite explícito `cCodStatus: "0"` com `lGratis: true`, registrado como `confirmation: accepted`. A conferência posterior descrita acima permanece para recuperação de pedidos existentes; nos novos, o faturamento sempre reconfere transportadora e valor salvo antes de emitir a NF-e.

O código `04227` também identifica Mini Envios quando a API não fornece descrição; `03298` é PAC e não é aceito nesse caso. Referência: [Manual oficial API Faturas dos Correios](https://www.correios.com.br/atendimento/developers/manuais/manual-api-faturas). O código não substitui a cotação: é necessário receber uma opção válida e seu `nIdFrete`.

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
