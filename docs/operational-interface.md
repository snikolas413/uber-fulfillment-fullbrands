# Indicadores e filas operacionais

`operation_orders` e `recipient_directory` são consultas somente leitura com
`security_invoker=true`. Preservam as políticas RLS das tabelas e não concedem
escrita. Usuários anônimos não recebem acesso. `operation_overview()` também
usa as permissões de quem consulta; não altera pedidos nem acessa o Omie.

Os totais são globais. As páginas de faturamento, separação e expedição mostram
até 100 registros por página com busca no servidor. Destinatários mostra 50.
O conjunto completo de documentos continua sendo carregado para a prévia de
duplicados na importação, independentemente da página e da busca atuais.
As validações no servidor continuam obrigatórias.

- **Pedidos não cancelados:** todos os estados exceto `cancelled`; o cartão abre
  exatamente o filtro correspondente. Cancelados inclui registros vinculados ao Omie.
- **NF-e autorizadas:** nota local `006` com número e chave, pedido não cancelado.
  Continua contando quando o pedido avança para expedição ou postagem.
- **Etiquetas prontas:** nota autorizada, geração `ready`, chave correspondente
  e caminho do PDF deste pedido e nota; ainda não marcado como enviado.
- **Prontos para faturar:** separação confirmada e conferências locais sem
  impedimentos registrados. As verificações completas no servidor e no Omie
  continuam sendo exigidas antes da emissão.
- **Aguardando NF-e:** submissão ou conferência em andamento. A fila independente
  continua consultando a nota, sem reenviar o faturamento.
- **Com pendência:** tentativa recusada, erro de confirmação ou impedimento local.
  O aviso fica disponível na linha com detalhes expansíveis.
- **Marcados como enviados:** estado local `shipped`. Não significa entrega
  confirmada pelos Correios. Não foi introduzida postagem automática.

NF-e e etiquetas são indicadores de etapas do mesmo pedido. Não se deve somá-los
ao total de pedidos. As filas de cada módulo são mutuamente exclusivas; um pedido
pode precisar de conferência em mais de um módulo. Os indicadores refletem a
última sincronização local, não uma consulta ao Omie a cada abertura do painel.

As listas e os detalhes preservam erros completos, documentos e ações de
conferência. Campos secundários e instruções foram recolhidos, sem retirar
confirmações de emissão, proteções de resultados incertos ou reservas de lote.

O Histórico usa paginação, período em horário de Brasília, nomes de eventos em
português e referência do pedido/NF-e quando disponível. Configurações é somente
consulta; não revela nem recebe credenciais ou alterações de permissão.
