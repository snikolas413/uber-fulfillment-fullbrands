# Referência dos novos pedidos: 1107

Conferência pela API `ConsultarPedido`, em 11/11/2026. Pedido Omie 2954518994,
item 2954519086. A consulta cobre as estruturas devolvidas pela API; não houve
conferência visual das abas. O pedido está cancelado: esse estado não é modelo.

| Área | Parâmetros para novos pedidos |
| --- | --- |
| Cabeçalho | Cliente Uber 2867720329; cenário 2954399884; etapa 10; condição 000, à vista, uma parcela |
| Item | Produto 2948561716, R18 REMOTE BUTTON; 1 PC; R$ 95,54; tabela 2; EAN 0035399175763; NCM 8517.62.99; CFOP 6.117; sem desconto/dedução |
| Item, informações adicionais | Categoria 1.01.03; estoque 1579847408; não gerar financeiro N; não movimentar estoque N; não somar total N; pesos zero; pedido de compra vazio |
| Informações adicionais | Categoria 1.01.03; conta 2611948369; consumidor final S; enviar e-mail N; enviar Pix N |
| Frete, exceção autorizada | Correios + seleção automática de Mini Envios, grátis para o cliente; não copiar o frete 9 sem transportadora do 1107 |
| E-mail, exceção autorizada | E-mail de cada destinatário, em lugar de correspondencias@uber.com |
| Entrega | Dados próprios de cada destinatário e endereço selecionado |
| Exportação | nao_exportacao N, como devolvido na referência |
| Parcelas | Uma parcela gerada pela condição à vista; data atual e total calculado, sem copiar vencimento/valor histórico |
| Observações e departamentos | Não devolvidos na referência; nenhum conteúdo adicional copiado |

No 1107 o ICMS tem CST 00, origem 1, modalidade 3, redução zero, alíquota
4%, base 107,96 e valor 4,32. IPI: CST 50, enquadramento 999, cálculo B,
13%, base 95,54, valor 12,42. PIS: CST 01, 1,65%, base 73,95, valor 1,22.
COFINS: CST 01, 7,6%, base 73,95, valor 5,62. DIFAL/FCP do destino RJ:
interna 20%, interestadual 4%, partilha 100%, FCP 2%.

**Bases, valores e regras por UF não são constantes do modelo.** `SimularImpostos`
recebe o cliente, cenário, produto, quantidade, preço e a UF real de entrega.
O sistema transmite os blocos fiscais graváveis completos retornados pela
simulação, inclusive bases e valores. Os blocos somente leitura de IBS/CBS
continuam sob cálculo do Omie. ICMS vazio ou incompleto impede inclusão/emissão
e informa o cenário e a UF sem cobertura. Não há substituição pela UF fiscal SP.

No faturamento, itens sem ICMS completo passam pela mesma simulação e por
`AlterarPedidoVenda`. A releitura precisa confirmar o ICMS antes de validar e
solicitar emissão. Pedidos já faturados não são alterados nem reemitidos.
Os pedidos existentes conservam preço/quantidade; os parâmetros comerciais
do modelo são obrigatórios apenas para novas inclusões.

Não copiar: número/códigos do pedido/item, integração, cancelamento, etapa de
pedido emitido, datas históricas, NF-e, protocolos, rastreio ou dados pessoais.
O preço anterior 107,97 e as flags S/S deixaram de ser padrão para novas inclusões.
As flags N/N autorizam os movimentos de estoque e financeiro conforme o Omie.

Evidência do teste anterior: pedido 1144 faturado em 11/11/2026 às 08:34,
NF-e 1240 autorizada, após preenchimento manual de ICMS pelo operador.
Isso não valida a persistência automática da nova implementação. O próximo
teste manual deve conferir a gravação dos impostos de um novo pedido antes de
qualquer emissão.

Contrato da API: https://app.omie.com.br/api/v1/produtos/pedido/
