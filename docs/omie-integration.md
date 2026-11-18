# Integração Omie

## Arquitetura escolhida
O aplicativo conversa exclusivamente com a API do Omie no servidor Next.js. O Omie continua sendo o sistema de registro para pedido, faturamento, documentos fiscais e expedição. A integração dos Correios já configurada dentro do Omie permanece responsável por cotação, etiqueta e postagem. O aplicativo não chama uma API externa dos Correios.

## Autenticação e segredos
O cliente server-side aceita dois modelos de autenticação:

### Modelo tradicional, App Key e App Secret
- Configure `OMIE_APP_KEY` e `OMIE_APP_SECRET` como variáveis privadas no Render.
- As duas credenciais são enviadas somente no corpo da chamada server-side da API Omie, nos campos `app_key` e `app_secret`.
- O App Key e App Secret precisam pertencer ao aplicativo Omie correto, FULL SERVICE TRADING LTDA.
- Quando as duas variáveis estão configuradas, o cliente usa o modelo tradicional e não tenta ler tokens do Supabase Vault.
- Não redefina a App Secret sem planejar a atualização de todos os sistemas que utilizam a chave atual.

### Modelo Bearer, token de aplicativo
- A API é chamada server-side com `Authorization: Bearer <access_token>`.
- O access token é renovado pelo endpoint oficial de refresh usando o `app_hash`, token atual e refresh token.
- O par de tokens rotativo é armazenado no Supabase Vault por funções acessíveis somente com `service_role`.
- O primeiro par pode ser carregado das variáveis privadas `OMIE_APP_HASH`, `OMIE_ACCESS_TOKEN`, `OMIE_REFRESH_TOKEN` e `OMIE_ACCESS_TOKEN_ISSUED_AT`.
- A conexão Omie usada durante desenvolvimento pelo conector não é herdada pelo app publicado.

Não configurar App Key/Secret e tokens Bearer simultaneamente sem uma decisão explícita de migração. O código prioriza App Key/Secret quando o par está presente. Segredos nunca são registrados em logs, enviados ao navegador ou versionados no GitHub.

O webhook que aparece na tela da integração Omie não é necessário ao fluxo atual. A aplicação realiza chamadas síncronas para inclusão e consulta de pedidos; a sincronização de expedição lê os dados que o próprio Omie recebeu da integração Correios.

## Mapeamento operacional observado em 04/11/2026
- Cliente Uber do Brasil Tecnologia Ltda., código Omie `2867720329`.
- Produto REMOTE BUTTON, código `R18`, ID Omie `2948561716`.
- Unidade `PC`, NCM `8517.62.99`.
- Padrão aprovado em 11/11/2026: pedido 1107, uma unidade a R$ 95,54, preço fixo e PO vazio.
- Cenário observado em venda para entrega futura: ID `2954399884`, descrição `5.117/6.117`, com CFOP de item `6.117`.
- Pedidos recentes consultados usam etapa inicial `10`, parcela personalizada `999`, categoria `1.01.03`, conta corrente `2611948369`, consumidor final `S`, e-mail automático `N`.
- Novas inclusões seguem o pedido 1107: `nao_movimentar_estoque = N` e `nao_gerar_financeiro = S`; estoque 1579847408.
- Esses valores são referências reais observadas, não substituem a aprovação fiscal/comercial antes do primeiro pedido real.

## Endereço e e-mail do motorista
O cliente do pedido permanece Uber. O motorista é informado como endereço físico de destino em `informacoes_adicionais.outros_detalhes`, usando os campos de nome, documento, logradouro, número, complemento, bairro, CEP, cidade/UF e telefone. Não criar um cliente Omie por motorista.

O e-mail salvo na preparação local é enviado em `informacoes_adicionais.utilizar_emails`, correspondente à aba **E-mail para o Cliente**. `informacoes_adicionais.enviar_email` permanece `N`, portanto preencher o destinatário não dispara o envio automático de NF-e, DANFE ou boleto.

## Ciclo operacional no aplicativo

### 1. Preparar e criar pedido
A preparação local fica no Supabase com chave estável `UFB-<uuid>`. Ao clicar em **Enviar ao Omie**, o servidor:
1. confere sessão e perfil admin/gestor/operador;
2. confere destinatário, endereço, e-mail e item;
3. reserva o pedido local em `order_pending`;
4. consulta o Omie pelo código de integração se a situação estiver pendente, antes de considerar nova repetição;
5. executa `IncluirPedido` apenas quando não há pedido localizado;
6. grava ID e número Omie e trilha de auditoria.

Se ocorrer timeout ou resultado incerto, o pedido permanece pendente e a aplicação não repete a inclusão automaticamente. O operador precisa conferir a fila do Omie antes de autorizar nova tentativa.

### 2. Sincronizar pedido e NF-e
A ação **Atualizar Omie** chama `StatusPedido` e reconcilia etapa, faturamento, cancelamento e dados de NF-e. Quando o Omie retorna dados fiscais, a aplicação salva número, série, chave, protocolo, emissão e link DANFE, além de registrar se o XML foi informado como disponível.

### 3. Faturar
O faturamento é uma ação distinta de criação do pedido. Na aba **Faturamento**, o operador seleciona até 100 pedidos e confirma **Faturar selecionados**. A fila consulta até 100 pendentes, priorizando os mais antigos, e até 100 faturados recentes separadamente; notas já emitidas não ocupam as vagas dos próximos pendentes. Ao encerrar um lote, a atualização carrega os próximos pedidos. Cada pedido é enviado em uma chamada server-side separada, em sequência, com progresso e resultado individual. Uma falha não interrompe os demais. A página precisa permanecer aberta; **Parar após o pedido atual** interrompe somente os próximos itens. O acesso para emitir exige usuário ativo admin/gestor/operador, revalidado no servidor em cada pedido; consulta não pode emitir.

O servidor exige confirmação explícita, pedido já criado e Mini Envios com frete grátis confirmado localmente, e reconfere no ERP o vínculo do pedido, cancelamento, bloqueio, transportadora e valor de frete. Durante o faturamento confirmado (nunca na criação), prepara a etapa `50` com `TrocarEtapaPedido` se necessário, confirma por `StatusPedido` e executa `ValidarPedidoVenda` com `nCodPed` e `cCodIntPed`. Somente uma validação com `cCodStatus: "0"` permite `FaturarPedidoVenda`, com os mesmos identificadores. Não troca produtos, quantidades, preços, cenário escolhido nem parâmetros de e-mail.

Na criação, o cenário escolhido é enviado tanto no cabeçalho quanto em `det.inf_adic.codigo_cenario_impostos_item`. Antes de reservar a inclusão, a aplicação consulta `ListarImpostosCenario` (`/geral/cenarios/`) para o cenário/cliente/produto e `ConsultarProduto` para a origem da mercadoria. Envia explicitamente `imposto.icms` com CST, origem, modalidade da base, redução, alíquota e FCP, equivalentes aos seletores da aba ICMS do item. Os valores vêm do cenário e do cadastro, sem constantes de CST, origem ou alíquota. `SimularImpostos` consulta os demais tributos com os valores atuais do item e a UF de entrega. Somente os parâmetros tributários são enviados; bases e valores em reais ficam para o Omie calcular. Uma falha dessas consultas não cria o pedido nem o deixa pendente de inclusão.

No faturamento, itens com campos ou cálculo de ICMS incompletos são completados via `AlterarPedidoVenda`, sob a reserva exclusiva de faturamento. O cenário continua sendo o do próprio item (cabeçalho apenas como alternativa). O preenchimento explícito substitui a tentativa anterior de reenviar somente a referência do cenário. Produto, quantidade, preço e indicadores operacionais são preservados. Os parâmetros de IPI/PIS/COFINS e outros grupos existentes são preservados sem congelar suas bases e valores anteriores, que podem mudar com o ICMS. Não envia campos somente de consulta como os parâmetros de IBS/CBS.

Uma nova consulta exige vínculo, frete, dados comerciais e os parâmetros de ICMS gravados corretamente. Para alíquota positiva, exige base calculada positiva e valor compatível com base × alíquota, com tolerância de um centavo. Base e valor do exemplo visual não são copiados. Campos numéricos opcionais de valor zero omitidos pelo Omie são reconhecidos na comparação. Endereços não são enviados na alteração e não há bloqueio customizado por UF. Uma falha mantém a tentativa como recusa anterior à emissão. A auditoria informa `tax_scenario_refresh_requested`. O resultado real precisa ser confirmado na próxima tentativa do operador; esse tratamento não substitui regras fiscais ausentes na configuração do ERP.

A restrição única `invoices.fulfillment_id` serve de reserva persistente antes de qualquer preparação ou solicitação de emissão, impedindo dois operadores de faturarem simultaneamente o mesmo pedido. O registro usa `billing_processing`, `billing_submitting`, `billing_submitted`, `billing_unknown` ou `billing_rejected` enquanto ainda não há NF-e. Antes de chamar `FaturarPedidoVenda`, a reserva passa a `billing_submitting` e a confirmação fica agendada no banco. Sem essa gravação, a emissão não é chamada. Uma recusa antes da chamada de emissão pode ser corrigida e tentada novamente por reserva condicional; resultado incerto depois de chamar `FaturarPedidoVenda` permanece bloqueado até conferência. Nenhuma emissão é repetida automaticamente, inclusive após timeout, recusa da emissão ou falha ao salvar a cópia local. O processamento de lote não começa ao carregar a página.

Depois do aceite, o lote segue para o próximo pedido sem fazer a consulta final na mesma ação. Uma fila persistente em `invoices.confirmation_*` faz somente `StatusPedido`, com primeira consulta e reagendamentos após pelo menos 61 segundos. A reserva da consulta dura 120 segundos, exige usuário ativo de operação e só pode ser finalizada pelo mesmo usuário e lease. Reabrir Faturamento retoma os jobs salvos; a conferência roda enquanto a página estiver aberta, independentemente do lote de emissão. Em caso de erro da API, o aviso fica no pedido e aquele job para; espera local de janela ou reserva apenas adia o job, sem contabilizar tentativa. Após 20 consultas sem NF-e confirmada, exige conferência manual. Uma consulta adiada não segura a fila global de requisições.

A confirmação exige uma única NF-e autorizada (`006`), protocolo, chave válida de 44 dígitos e número/série compatíveis com a chave, vinculada ao pedido e código de integração esperados. Somente então são sincronizados os dados fiscais e o pedido é marcado como faturado. Um aceite sem esses dados aparece como **Aguardando confirmação da NF-e**, separado dos erros. **Atualizar Omie** continua disponível para conferência manual sem emitir novamente. O histórico registra `omie.invoice.result` para a solicitação e `omie.invoice.confirmed` para a confirmação.

Referências oficiais: [PedidoVendaFaturamento](https://app.omie.com.br/api/v1/produtos/pedidovendafat/) e [PedidoVendaProduto](https://app.omie.com.br/api/v1/produtos/pedido/).

Diagnóstico real em 10/11/2026, sem alterar pedido ou emitir nota: para o pedido 1142, `SimularImpostos` com o cenário 2954399884, produto R18, cliente Uber, consumo final e `uf_entrega: "SC"` retornou `imposto.icms: {}` e CFOP vazio. A mesma simulação sem `uf_entrega` (cadastro fiscal do cliente) retornou CST 00, origem 1, modalidade 3, alíquota 4%, base 122,01 e valor 4,88. Essa diferença deve ser resolvida pela definição do contexto fiscal da operação ou pelas regras do cenário; não deve ser ocultada com preenchimento arbitrário de tributos. O diagnóstico temporário de inicialização foi removido após coletar os retornos nos logs do Render.

### 4. Correios e expedição
A seleção de Mini Envios usa a API de Frete do Omie: `CotarFrete` e, para uma única opção Mini Envios da transportadora Correios, `SelecionarFrete` com `nIdFrete` e `lGratis: true`. **Enviar ao Omie** inclui o pedido e executa essa etapa automaticamente; a mesma sequência conclui o frete quando recupera uma inclusão pendente já localizada no ERP. A etapa do pedido permanece inalterada. Uma falha mantém o pedido criado, com aviso persistido e ação **Tentar frete novamente**, visível somente em caso de pendência de frete, sem repetir a inclusão. Erros de negócio da API, inclusive HTTP 500, encerram somente as etapas do pedido com falha e ficam registrados na linha e na auditoria. Os lotes de inclusão, faturamento e etiquetas continuam para o próximo pedido, sem repetir a operação que falhou. Bloqueios de consumo e indisponibilidade geral preservam a pausa de proteção; o lote aguarda a liberação antes de iniciar o próximo pedido. Ocupação da reserva por outra operação é tratada como espera, sem recusar o pedido. Consultas estáveis idênticas usam cache curto; conferências frescas respeitam a janela de 61 segundos. A proteção é compartilhada no Supabase.

O vínculo do pedido, seu estado não cancelado/não faturado e a transportadora são conferidos antes da seleção. Pedidos recém-criados exigem aceite explícito da seleção com `lGratis: true`; recuperações de pedidos existentes também consultam após a resposta. Antes de faturar, a aplicação sempre confere a transportadora e o frete zero salvo no Omie. O cenário fiscal permanece o atual e a PO continua vazia. A automação de envio não gera frete, etiqueta ou postagem.

A criação resolve no Omie um único cadastro ativo de EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS e envia seu ID em `frete.codigo_transportadora`. Em pedido existente sem transportadora, a ação de Mini Envios define esse mesmo cadastro e confere a gravação antes de cotar. Não sobrescreve outra transportadora existente. A auditoria de pendências registra o motivo, e **Atualizar Omie** preserva avisos iniciados por `Frete:` até que a seleção seja concluída.

## Migrations
As migrations abaixo foram aplicadas ao projeto Supabase conectado em 04/11/2026, sem criar branch adicional:
- `20261104130000_prepare_uber_fulfillment_customer_email.sql`
- `20261104140000_omie_credentials_and_sync_metadata.sql`

A validação confirmou as colunas de e-mail, sincronização, DANFE e frete; a função de preparação com a nova assinatura; e que as funções Vault só podem ser executadas por `service_role` (sem execução por `anon` ou `authenticated`). Nenhum dado de negócio foi apagado ou atualizado por essas migrations.

## Próximos passos
- Configurar App Key e App Secret do aplicativo Omie correto como variáveis privadas no Render, ou concluir a configuração Bearer/Vault.
- Fazer uma chamada somente de leitura ao Omie para validar autenticação, empresa, cliente e produto.
- Confirmar com o responsável fiscal o cenário, CFOP, preço, parcela, categoria, conta, flags de estoque/financeiro e dados do destino.
- Fazer o primeiro pedido com supervisão do operador, depois testar consulta e conciliação.
- O botão de faturamento pode emitir NF-e real e exige confirmação explícita.
- A expedição será validada usando a integração Correios dentro do Omie, sem duplicar integração externa.


## Política financeira atual (18/11/2026)

Novos pedidos usam condição personalizada `999`, uma parcela de 100% com vencimento em **31/12/2026**, `cabecalho.nao_gerar_boleto = S`, `parcela.nao_gerar_boleto = S` e `det[].inf_adic.nao_gerar_financeiro = S`. A movimentação de estoque permanece habilitada. A preparação local não gera títulos nem boletos. O faturamento confere essa política antes de solicitar emissão; pedidos antigos precisam estar corrigidos no Omie. A manutenção de vencimentos e flags não solicita faturamento.

Conferência real no Omie: quando todos os itens usam `nao_gerar_financeiro = S`, o ERP remove as parcelas e pode omitir o padrão `nao_gerar_boleto` nas consultas. Sem parcelas, não há vencimento ou boleto gerado. A conferência aceita esse retorno; se houver parcelas, exige 31/12/2026 e não gerar boleto em cada uma.

## Envio intercalado de dois pedidos (18/11/2026)

O lote de envio mantém até dois pedidos distintos em andamento. Quando um termina, sua vaga recebe o próximo selecionado. A espera de 61 segundos de uma consulta libera o agendamento para outro pedido; a janela é conferida novamente antes da chamada. O controle global continua permitindo apenas uma chamada externa por vez, com espaçamento e pausas persistidas. Falhas não repetem a operação: ficam no pedido e liberam a vaga, respeitando eventual bloqueio geral da API.

A reserva individual é adquirida antes das consultas fiscais e de transportadora. Somente após essas validações o pedido passa a `order_pending`, antes da inclusão. A rota autenticada de envio reutiliza as validações da ação existente e nunca autoriza reinclusão. Inclusões com resultado incerto exigem reconciliação. O botão de parada impede novos envios e deixa os dois pedidos ativos concluírem. Mantenha a página aberta durante o lote.

Continuam como propostas futuras: pré-validar o lote, ampliar o cache dos cadastros estáveis e avaliar execução em segundo plano. Medir um piloto de 10–20 pedidos antes de ampliar a concorrência; o ganho real depende dos tempos do Omie. Conferências fiscais/de vínculo e proteções contra duplicidade permanecem obrigatórias.

## Expedição intercalada (18/11/2026)

O lote de etiquetas também mantém até dois pedidos distintos em andamento, por requisições HTTP independentes que reutilizam a ação autenticada de geração. As chamadas Omie continuam serializadas pelo controle global. A validação de NF-e autorizada e vinculada, a reserva atômica da geração e o bloqueio de estados `processing`/`unknown` são preservados. Etiquetas salvas são reutilizadas. Uma falha encerra a tentativa daquele pedido e libera a vaga, sem repetir operações de frete ou etiqueta e respeitando a pausa global quando houver.

O PDF do lote inclui somente sucessos com arquivo confirmado e mantém a ordem da seleção, mesmo quando outro pedido termina antes. “Parar novos envios” impede iniciar os pedidos restantes e permite concluir os dois ativos. A página deve permanecer aberta até concluir a preparação e montagem do PDF.
