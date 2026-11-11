# Preparação de pedidos Uber

## Fluxo
A aplicação registra uma preparação local por destinatário, com endereço versionado, PO, item, quantidade, preço e e-mail para NF-e. Ao clicar em **Enviar ao Omie**, é criado um pedido de venda real no ERP, mantendo Uber como cliente e o motorista como destino físico.

## Preparação em massa
Em **Preparar pedido**, busque destinatários e marque de 1 a 100 por lote.
**Selecionar visíveis** respeita a busca e o limite do lote. Cada linha mantém seu
próprio endereço e e-mail, que podem ser conferidos antes de iniciar. O endereço
mais recente que não está inválido é selecionado inicialmente; endereços pendentes
são aceitos. Destinatários sem endereço disponível ou sem e-mail válido precisam
ser corrigidos antes de selecionar.

**Preparar N pedido(s)** cria uma preparação por destinatário, sequencialmente,
pelos parâmetros do pedido 1107 (uma unidade de R18, R$ 95,54, PO vazio).
A janela permanece aberta com o resultado de cada linha e contagem de sucessos
e erros. Uma falha não impede os outros registros. Pedidos concluídos não são
reenviados ao repetir o botão; a chave de cada tentativa é conservada nesta janela
para recuperar uma resposta perdida sem duplicar a preparação. Após iniciar uma
linha, seus dados ficam bloqueados para que uma repetição use o mesmo conteúdo.
Mantenha a janela aberta até o lote terminar. Fechar e iniciar outro lote é uma
nova solicitação de pedidos, inclusive para destinatários já usados anteriormente.
O lote não envia pedidos ao Omie nem solicita faturamento; essas etapas permanecem
separadas. Não é necessária alteração no esquema do banco.

## Referências operacionais consultadas em 04/11/2026
- Cliente Uber do Brasil Tecnologia Ltda., ID Omie `2867720329`.
- Produto REMOTE BUTTON, código `R18`, ID Omie `2948561716`, unidade PC, NCM `8517.62.99`.
- Padrão aprovado em 11/11/2026: pedido 1107, uma unidade a R$ 95,54, preço fixo e PO vazio.
- Cenário de venda para entrega futura ID `2954399884`, CFOP de item observado `6.117`.
- Novos pedidos recentes consultados usam etapa inicial `10`, parcela `000`, categoria `1.01.03`, conta corrente `2611948369`, consumidor final `S`.
- Novas inclusões seguem o pedido 1107: `nao_movimentar_estoque = N` e `nao_gerar_financeiro = N`; estoque 1579847408.

Esses valores são referências reais do Omie consultadas para desenhar a integração. Antes do primeiro envio é necessária confirmação do responsável fiscal/comercial de que continuam aplicáveis à operação corrente.

## E-mail para o cliente
O e-mail do destinatário é carregado na preparação, pode ser ajustado para o pedido e fica guardado como snapshot. No Omie, é enviado para `informacoes_adicionais.utilizar_emails`, que preenche a aba **E-mail para o Cliente**. `enviar_email` permanece `N`; a aplicação não dispara documentos por e-mail automaticamente.

## Envio seguro ao Omie
Na tabela **Pedidos preparados**, marque pedidos com status **Rascunho preparado**
e sem código Omie. A caixa do cabeçalho marca os pedidos elegíveis visíveis na
busca. **Enviar selecionados ao Omie** envia até 100 por lote, com uma confirmação
para o conjunto. Cada pedido passa pela mesma ação do envio individual, incluindo
impostos e seleção automática de Correios + Mini Envios grátis. Não há faturamento.
O processamento é sequencial, mostra resultado em cada linha e continua após erros.
**Parar após o pedido atual** evita iniciar os próximos, sem cancelar o que já foi enviado.
Mantenha a página aberta. Uma resposta perdida não é repetida automaticamente e
o lote nunca autoriza reinclusão: use **Atualizar Omie** e o fluxo individual para
conferir pendências. Enquanto o lote roda, os botões individuais ficam desativados.

O envio usa código de integração determinístico por pedido local. Antes de uma nova inclusão, pedidos pendentes são consultados por esse código para evitar duplicidade. Timeout é tratado como resultado desconhecido e exige reconciliação; não há repetição automática. A inclusão guarda o ID e número retornados pelo Omie.

## Faturamento e expedição
O faturamento ocorre por ação separada com confirmação explícita na aba **Faturamento**: selecione até 100 pedidos e clique em **Faturar selecionados**. O lote é processado em sequência, com resultado individual, e a página deve permanecer aberta. Antes de solicitar NF-e, a aplicação reconfere o pedido e o frete, reserva a emissão para impedir concorrência, prepara e confirma a etapa `50` somente durante este faturamento e exige resultado positivo da validação do Omie. Depois lê o estado fiscal e os dados de NF-e retornados. Um aceite ainda sem confirmação de nota aparece como pendência e não é reenviado automaticamente. Consulte **Atualizar Omie** para reconciliar tentativas anteriores.

Ao clicar em **Enviar ao Omie**, a aplicação resolve o cadastro ativo dos Correios, cria o pedido e seleciona automaticamente uma única opção Mini Envios pela API de Frete do Omie (`CotarFrete` e `SelecionarFrete` com `nIdFrete` e `lGratis: true`). A etapa permanece a atual, sem faturamento. Uma falha deixa a pendência visível sem refazer a inclusão. Somente em caso de pendência de frete aparece **Tentar frete novamente**, para recuperar essa etapa em pedidos existentes ainda não faturados; se a transportadora estiver vazia, define Correios e confere antes de cotar. Consultas bloqueadas por `REDUNDANT` aguardam o prazo informado dentro dos limites documentados e são repetidas uma vez. Etiqueta e postagem continuam dentro do Omie. O app também consulta o pedido para importar frete, modalidade, volumes, previsão e rastreio. Não existe chamada direta aos Correios pelo app.

## Configuração ainda necessária
- Credenciais próprias do app Omie (app_hash, access token, refresh token e timestamp ISO do primeiro token) no Render.
- Confirmação fiscal/comercial dos parâmetros de venda e faturamento antes do primeiro pedido real.
- Teste assistido de inclusão, sincronização, faturamento e leitura de expedição após o deploy. Não execute faturamento real sem conferência e confirmação explícita.
