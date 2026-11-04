# Integração Omie

## Princípios
1. Usar credenciais próprias da aplicação, guardadas no ambiente seguro do servidor. A conexão MCP do ChatGPT não é herdada pela aplicação publicada.
2. Implementar primeiro consultas e mapeamento de cadastros.
3. Isolar operações mutáveis e registrar request/response resumidos, sem segredos.
4. Tratar timeout como resultado desconhecido, não como falha confirmada.

## Operações a implementar e validar
- Consultar empresa, clientes, produtos, pedidos e status.
- Consultar transportadoras, modalidades, tipos de entrega, embalagens e serviços.
- Incluir pedido por destinatário.
- Faturar pedidos individualmente e em lote com confirmação.
- Cotar, gerar e vincular frete; obter rastreio e etiqueta.
- Obter DANFE e XML da NF-e.

## Faturamento em lote
1. Validar situação e elegibilidade de cada pedido.
2. Mostrar a lista exata e exigir confirmação do operador.
3. Executar cada faturamento individualmente, com correlação local.
4. Consultar status fiscal após a execução.
5. Não refaturar automaticamente resultados incertos.
