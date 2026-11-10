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

O tipo de entrega de novos pedidos é **Mini Envios**. Antes de reservar ou incluir o pedido, o servidor consulta `ListarTipoEntrega` em `/geral/tiposentrega/`, percorre as páginas e exige um único cadastro ativo com descrição Mini Envios (também aceita Correios - Mini Envios / Mini Envios Correios, ignorando acentos e pontuação). Não usa busca parcial nem um código numérico presumido.

O `nCodEntrega` retornado é enviado como `frete.codigo_tipo_entrega`; se o cadastro informa uma transportadora (`nCodTransp` positivo), ela acompanha em `frete.codigo_transportadora`. O `cCodIntEntrega` identifica a integração do cadastro, mas não substitui o código numérico no pedido. A modalidade CIF/FOB não é definida por essa seleção.

Cadastro ausente, inativo, ambíguo ou resposta inválida bloqueia a inclusão antes de alterar o status local. O formulário oferece **Conferir tipo no Omie**, que consulta o catálogo e mostra o código, sem criar pedido. A inclusão registra o tipo e a transportadora na auditoria. Pedidos existentes não são alterados automaticamente.

Para o teste atual, a PO será deixada vazia e o cenário fiscal permanece `2954399884`. A seleção de Mini Envios preenche o tipo de entrega; cotação, contratação, etiqueta e postagem continuam no fluxo do ERP.
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
O faturamento é uma ação distinta de criação do pedido. A tela exige confirmação explícita. O servidor consulta o status atual, impede faturamento de pedidos cancelados/já faturados, exige etapa `50` (Faturar), executa `ValidarPedidoVenda` e só chama `FaturarPedidoVenda` quando a pré-validação retorna código de sucesso `0`. Depois consulta novamente `StatusPedido` para reconciliar o resultado.

### 4. Correios e expedição
A equipe usa a integração Correios já configurada dentro do Omie para cotação, emissão da etiqueta e postagem. Depois dessa operação, o app chama apenas `ConsultarPedido` no Omie e copia para o banco local o que o ERP já registrou: transportadora, serviço/modalidade, frete, volumes, código de rastreio, link e previsão de entrega. A aplicação não gera etiquetas nem chama diretamente os Correios.

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
