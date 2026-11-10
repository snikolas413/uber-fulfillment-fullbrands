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
- Preço de catálogo consultado: R$ 107,97. Há pedido anterior com valor negociado diferente (R$ 95,54), por isso o valor continua editável e deve ser conferido por pedido.
- Cenário observado em venda para entrega futura: ID `2954399884`, descrição `5.117/6.117`, com CFOP de item `6.117`.
- Pedidos recentes consultados usam etapa inicial `10`, parcela `000`, categoria `1.01.03`, conta corrente `2611948369`, consumidor final `S`, e-mail automático `N`.
- Nos pedidos de entrega futura analisados, o item utilizou `nao_movimentar_estoque = S` e `nao_gerar_financeiro = S`.
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

A restrição única `invoices.fulfillment_id` serve de reserva persistente antes de qualquer preparação ou solicitação de emissão, impedindo dois operadores de faturarem simultaneamente o mesmo pedido. O registro usa `billing_processing`, `billing_submitted`, `billing_unknown` ou `billing_rejected` enquanto ainda não há NF-e. Uma recusa antes da chamada de emissão pode ser corrigida e tentada novamente por reserva condicional; resultado incerto depois de chamar `FaturarPedidoVenda` permanece bloqueado até conferência. Nenhuma emissão é repetida automaticamente, inclusive após timeout, recusa da emissão ou falha ao salvar a cópia local. O processamento de lote não começa ao carregar a página.

Depois da solicitação, `StatusPedido` diferencia aceite do faturamento e confirmação de NF-e. Quando há confirmação, a reconciliação salva número, chave, documentos e situação fiscal disponíveis. Um simples aceite sem dados fiscais aparece como pendência, sem ser apresentado como nota emitida. **Atualizar Omie** consulta o estado fiscal e pode reconciliar uma solicitação anterior sem emitir novamente. O histórico registra `omie.invoice.result` com o resultado de cada tentativa.

Referências oficiais: [PedidoVendaFaturamento](https://app.omie.com.br/api/v1/produtos/pedidovendafat/) e [PedidoVendaProduto](https://app.omie.com.br/api/v1/produtos/pedido/).

Diagnóstico real em 10/11/2026, sem alterar pedido ou emitir nota: para o pedido 1142, `SimularImpostos` com o cenário 2954399884, produto R18, cliente Uber, consumo final e `uf_entrega: "SC"` retornou `imposto.icms: {}` e CFOP vazio. A mesma simulação sem `uf_entrega` (cadastro fiscal do cliente) retornou CST 00, origem 1, modalidade 3, alíquota 4%, base 122,01 e valor 4,88. Essa diferença deve ser resolvida pela definição do contexto fiscal da operação ou pelas regras do cenário; não deve ser ocultada com preenchimento arbitrário de tributos. O diagnóstico temporário de inicialização foi removido após coletar os retornos nos logs do Render.

### 4. Correios e expedição
A seleção de Mini Envios usa a API de Frete do Omie: `CotarFrete` e, para uma única opção Mini Envios da transportadora Correios, `SelecionarFrete` com `nIdFrete` e `lGratis: true`. **Enviar ao Omie** inclui o pedido e executa essa etapa automaticamente; a mesma sequência conclui o frete quando recupera uma inclusão pendente já localizada no ERP. A etapa do pedido permanece inalterada. Uma falha mantém o pedido criado, com aviso persistido e ação **Tentar frete novamente**, visível somente em caso de pendência de frete, sem repetir a inclusão. Consultas de leitura com bloqueio `REDUNDANT` e prazo válido aguardam o intervalo informado antes de uma única nova consulta; operações de escrita não são repetidas por esse tratamento.

O vínculo do pedido, seu estado não cancelado/não faturado e a transportadora são conferidos antes da seleção; após a resposta, o pedido é consultado para conferir os dados retornados e frete zero para o cliente. O cenário fiscal permanece o atual e a PO será deixada vazia no teste. A automação não gera frete, etiqueta ou postagem. A equipe continua essas etapas no Omie, e a sincronização local importa os dados já registrados no ERP.

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
