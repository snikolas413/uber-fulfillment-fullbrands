# Integração Omie

## Arquitetura escolhida
O aplicativo conversa exclusivamente com a API do Omie no servidor Next.js. O Omie continua sendo o sistema de registro para pedido, faturamento, documentos fiscais e expedição. A integração dos Correios já configurada dentro do Omie permanece responsável por cotação, etiqueta e postagem. O aplicativo não chama uma API externa dos Correios.

## Autenticação e segredos
- A API é chamada server-side com `Authorization: Bearer <access_token>`.
- O access token é renovado pelo endpoint oficial de refresh usando o `app_hash`, token atual e refresh token.
- O par de tokens rotativo é armazenado no Supabase Vault por funções acessíveis somente com `service_role`.
- Os valores iniciais são carregados uma única vez do ambiente privado do Render e transferidos ao Vault. O código não registra tokens nem credenciais em logs.
- A aplicação exige `OMIE_APP_HASH`, `OMIE_ACCESS_TOKEN`, `OMIE_REFRESH_TOKEN` e `OMIE_ACCESS_TOKEN_ISSUED_AT` no primeiro bootstrap.
- A conexão Omie usada durante desenvolvimento pelo conector não é herdada pelo app publicado. É necessário criar credenciais próprias para esta aplicação.

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
4. consulta o Omie pelo código de integração se a situação estiver pendente, antes de considerar nova inclusão;
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
As migrations adicionadas nesta PR devem ser aplicadas em ambiente isolado antes do deploy:
- `20261104130000_prepare_uber_fulfillment_customer_email.sql`
- `20261104140000_omie_credentials_and_sync_metadata.sql`

A segunda cria funções Vault restritas à service role, campos de controle de sincronização e metadados para documentos e frete.

## Bloqueios antes do primeiro uso real
- Configurar credenciais próprias da aplicação no Render, incluindo data/hora ISO de emissão do primeiro token.
- Aplicar e validar as migrations em banco de desenvolvimento.
- Confirmar com o responsável fiscal o cenário, CFOP, preço, parcela, categoria, conta, flags de estoque/financeiro e os dados de destino.
- Fazer o primeiro pedido com supervisão do operador, depois testar consulta e conciliação.
- O botão de faturamento pode emitir NF-e real e exige confirmação explícita.
- A expedição será validada usando a integração Correios dentro do Omie, sem duplicar integração externa.
