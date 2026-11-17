# Preparação de pedidos Uber

## Fluxo
A aplicação registra uma preparação local por destinatário, com endereço versionado, PO, item, quantidade, preço e e-mail para NF-e. Ao clicar em **Enviar ao Omie**, é criado um pedido de venda real no ERP, mantendo Uber como cliente e o motorista como destino físico.

## Preparação em massa
Em **Preparar pedido**, busque destinatários e marque de 1 a 100 por lote.
Somente destinatários sem preparação anterior aparecem na seleção. O filtro
considera todo o histórico e qualquer status de pedido, inclusive cancelado.
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
Mantenha a janela aberta até o lote terminar. Destinatários preparados com sucesso
saem da seleção durante o lote; a contagem de sucessos é preservada. Ao fechar,
reabrir ou atualizar a página, destinatários já usados continuam fora da seleção.
O lote não envia pedidos ao Omie nem solicita faturamento; essas etapas permanecem
separadas. Não é necessária alteração no esquema do banco.

## Controle dos pedidos e envio ao Omie

A tela abre em **Aguardando envio**, com pedidos preparados ainda sem vínculo no
Omie. **Enviados ao Omie** reúne pedidos com ID Omie confirmado, inclusive os que
avançaram para faturamento ou expedição. **Revisar** reúne tentativas pendentes ou
com erro e sem ID Omie.
**Cancelados sem envio** e **Todos** permitem consultar o restante do histórico.

Os indicadores mostram os totais do banco, independentemente da página e da busca.
A lista tem páginas de 100 pedidos, com navegação **Anterior/Próxima** e contagem
dos resultados. A busca por destinatário, número Omie, PO, e-mail ou código do
produto consulta todo o filtro escolhido, incluindo pedidos fora da página atual.
Mudar o filtro ou buscar reinicia a paginação e a seleção. O envio continua limitado
a 100 pedidos por lote, com resultado por linha; navegar e buscar não enviam pedidos.
Os controles de navegação e busca ficam bloqueados durante o envio.

## Corrigir um pedido em Revisar

Operadores, gestores e administradores podem clicar em **Editar pedido** nos
pedidos em Revisar que ainda não têm vínculo com o Omie. O formulário carrega o
endereço vinculado ao pedido, o nome de entrega e o e-mail para NF-e, junto do
último erro. Nome, rua, bairro e complemento aceitam até 60 caracteres, número
até 10, CEP com 8 dígitos e município sem UF. Confira os dados antes de salvar.

**Salvar correções** cria uma nova versão do endereço e guarda nome e e-mail
nesse pedido, com auditoria. O cadastro original e os demais pedidos são
preservados. O endereço continua pendente de validação; a confirmação manual não
declara uma validação postal. O erro anterior fica disponível como histórico.
Salvar mantém o pedido em Revisar e não chama o Omie.

Depois, feche a edição e clique individualmente em **Enviar ao Omie**. A ação
consulta o código de integração antes de uma nova inclusão, recupera um pedido
existente e pede confirmação separada quando não o encontra. Falhas de consulta
bloqueiam a inclusão. Pedidos em Revisar continuam fora do envio em lote.
Edições concorrentes são rejeitadas e o envio reserva o pedido para impedir
correções durante a inclusão. Após uma interrupção, a reserva expira em 15 minutos;
a próxima tentativa ainda reconcilia o código de integração antes de incluir.

A publicação desta edição requer aplicar a migration
`20261117122202_review_order_editing.sql` antes de publicar o código.

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

Ao clicar em **Enviar ao Omie**, a aplicação resolve o cadastro ativo dos Correios, cria o pedido e seleciona automaticamente uma única opção Mini Envios pela API de Frete do Omie (`CotarFrete` e `SelecionarFrete` com `nIdFrete` e `lGratis: true`). A etapa permanece a atual, sem faturamento. Uma falha deixa a pendência visível sem refazer a inclusão. Somente em caso de pendência de frete aparece **Tentar frete novamente**, para recuperar essa etapa em pedidos existentes ainda não faturados; se a transportadora estiver vazia, define Correios e confere antes de cotar. Falhas da API pausam a integração e não disparam repetição automática. Etiqueta e postagem continuam dentro do Omie. O app também consulta o pedido para importar frete, modalidade, volumes, previsão e rastreio. Não existe chamada direta aos Correios pelo app.

### Informações complementares da NF-e

Pedidos novos enviam em `informacoes_adicionais.dados_adicionais_nf` a frase:
“Entrega em domicílio de terceiro destinatário não contribuinte do ICMS”.
Antes de faturar pelo aplicativo, pedidos existentes também recebem essa frase,
se ausente, preservando as observações anteriores e usando `|` como separador
de linhas do Omie. A frase não é duplicada e `consumidor_final` permanece inalterado.

Depois de alterar o pedido, o aplicativo consulta o Omie novamente e exige a
confirmação do texto completo antes de solicitar a emissão. Falha na atualização
ou na conferência impede o faturamento. Pedidos cancelados ou já faturados não
são alterados. Nos pedidos pendentes, a atualização ocorre quando o usuário
aciona o faturamento pelo aplicativo; não há emissão automática em segundo plano
nem alteração de notas já autorizadas.

### Desempenho e proteção da API Omie

O envio de um pedido recém-incluído reaproveita a transportadora resolvida para a
inclusão. Depois da cotação, consulta uma vez o pedido para conferir vínculo,
situação e transportadora, e exige `cCodStatus: "0"` de `SelecionarFrete` com
`lGratis: true`. O aceite é identificado na auditoria como `confirmation: accepted`;
a transportadora e o valor efetivamente salvos continuam sendo conferidos antes
do faturamento. Recuperações de pedidos existentes mantêm a conferência posterior.

Consultas idênticas de cadastro, cenário e simulação usam cache de sucesso de 61
segundos, com chave incluindo todos os parâmetros (inclusive UF). Consultas de
pedido, NF-e e status nunca usam cache; quando repetidas, aguardam a janela de
61 segundos antes de acessar o Omie. Nenhuma falha dispara repetição automática,
incluindo `REDUNDANT`, cotação indisponível e HTTP 401.

As chamadas passam por uma fila no servidor e uma reserva persistente compartilhada
no Supabase, com uma chamada por vez e intervalo mínimo de 300 ms. Qualquer erro
de transporte, resposta inválida, `faultstring` ou status de negócio recusado pausa
a integração por no mínimo 61 segundos. HTTP 425 ou indicação de consumo indevido
pausa por no mínimo 30 minutos; prazos maiores de `Retry-After` ou da mensagem são
respeitados, até 24 horas. Cliques durante a pausa não acessam a API nem renovam
o prazo. A reserva expira em 120 segundos caso o processo seja interrompido.
Se o controle no banco estiver indisponível, o sistema não envia chamadas ao Omie.

O lote de envio para na primeira falha ou pendência. Os pedidos ainda não
processados permanecem selecionados, sem envio. Retomar exige uma nova ação do
usuário após conferir o erro e respeitar a pausa. Pedidos com inclusão incerta
continuam exigindo reconciliação antes de autorizar nova inclusão.

Referência: [Limites de Consumo da API do Omie](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie).

## Configuração ainda necessária
- Credenciais próprias do app Omie (app_hash, access token, refresh token e timestamp ISO do primeiro token) no Render.
- Confirmação fiscal/comercial dos parâmetros de venda e faturamento antes do primeiro pedido real.
- Teste assistido de inclusão, sincronização, faturamento e leitura de expedição após o deploy. Não execute faturamento real sem conferência e confirmação explícita.
