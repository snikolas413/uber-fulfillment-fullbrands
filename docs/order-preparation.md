# Preparação de pedidos Uber

## Fluxo
A aplicação registra uma preparação local por destinatário, com endereço versionado, PO, item, quantidade, preço e e-mail para NF-e. Ao clicar em **Enviar ao Omie**, é criado um pedido de venda real no ERP, mantendo Uber como cliente e o motorista como destino físico.

## Referências operacionais consultadas em 04/11/2026
- Cliente Uber do Brasil Tecnologia Ltda., ID Omie `2867720329`.
- Produto REMOTE BUTTON, código `R18`, ID Omie `2948561716`, unidade PC, NCM `8517.62.99`.
- Preço de catálogo R$ 107,97; preço negociado anterior R$ 95,54. O app mantém o preço editável.
- Cenário de venda para entrega futura ID `2954399884`, CFOP de item observado `6.117`.
- Novos pedidos recentes consultados usam etapa inicial `10`, parcela `000`, categoria `1.01.03`, conta corrente `2611948369`, consumidor final `S`.
- Pedido recente de entrega futura usou flags `nao_movimentar_estoque = S` e `nao_gerar_financeiro = S`.

Esses valores são referências reais do Omie consultadas para desenhar a integração. Antes do primeiro envio é necessária confirmação do responsável fiscal/comercial de que continuam aplicáveis à operação corrente.

## E-mail para o cliente
O e-mail do destinatário é carregado na preparação, pode ser ajustado para o pedido e fica guardado como snapshot. No Omie, é enviado para `informacoes_adicionais.utilizar_emails`, que preenche a aba **E-mail para o Cliente**. `enviar_email` permanece `N`; a aplicação não dispara documentos por e-mail automaticamente.

## Envio seguro ao Omie
O envio usa código de integração determinístico por pedido local. Antes de uma nova inclusão, pedidos pendentes são consultados por esse código para evitar duplicidade. Timeout é tratado como resultado desconhecido e exige reconciliação; não há repetição automática. A inclusão guarda o ID e número retornados pelo Omie.

## Faturamento e expedição
O faturamento ocorre por ação separada com confirmação explícita. Antes de solicitar NF-e, a aplicação verifica o pedido, etapa `50` (Faturar) e o resultado positivo da validação do Omie. Depois lê o estado fiscal e os dados de NF-e retornados.

Ao clicar em **Enviar ao Omie**, a aplicação resolve o cadastro ativo dos Correios, cria o pedido e seleciona automaticamente uma única opção Mini Envios pela API de Frete do Omie (`CotarFrete` e `SelecionarFrete` com `nIdFrete` e `lGratis: true`). A etapa permanece a atual, sem faturamento. Uma falha deixa a pendência visível sem refazer a inclusão. Somente em caso de pendência de frete aparece **Tentar frete novamente**, para recuperar essa etapa em pedidos existentes ainda não faturados; se a transportadora estiver vazia, define Correios e confere antes de cotar. Consultas bloqueadas por `REDUNDANT` aguardam o prazo informado dentro dos limites documentados e são repetidas uma vez. Etiqueta e postagem continuam dentro do Omie. O app também consulta o pedido para importar frete, modalidade, volumes, previsão e rastreio. Não existe chamada direta aos Correios pelo app.

## Configuração ainda necessária
- Credenciais próprias do app Omie (app_hash, access token, refresh token e timestamp ISO do primeiro token) no Render.
- Confirmação fiscal/comercial dos parâmetros de venda e faturamento antes do primeiro pedido real.
- Teste assistido de inclusão, sincronização, faturamento e leitura de expedição após o deploy. Não execute faturamento real sem conferência e confirmação explícita.
