# Expedição: etiqueta Correios com NF-e

Formato aprovado: térmica 100 × 150 mm, tamanho real, sem ajuste automático da
impressora. Uma página por volume. O PDF original do Omie fica preservado e é
incorporado proporcionalmente no topo; abaixo são adicionados número da NF-e,
série, data, chave de 44 dígitos e código CODE128 com a mesma chave.
Não são recriados rastreio, DataMatrix, contrato, remetente ou destinatário.
O rodapé reproduz o bloco solicitado no exemplo; não substitui a NF-e/XML nem
modifica documentos fiscais no Omie.

## Operação

1. Na Expedição, clique em **Gerar etiqueta + NF-e** e confirme a solicitação.
2. A aplicação confere o faturamento e a autorização da NF-e no Omie, inclusive
   nos pedidos cujo aceite de faturamento ainda está pendente de confirmação local.
3. `GerarEtiqueta` recebe somente `nIdPedido`, no serviço `/produtos/frete/`.
   O PDF é baixado de `listaEtiqueta[].cUrlEtiqueta`.
4. Original e PDF combinado ficam no bucket privado `shipping-labels`.
5. **Abrir etiqueta 100 × 150** abre o PDF salvo. Use a impressão do visualizador
   em escala 100%. Reimprimir não chama a operação de geração do Omie.

Não há `GerarFrete`, nova cotação, postagem, emissão ou alteração da NF-e nesse
fluxo. A encomenda deve ter sido criada pelo faturamento e pela integração Omie
com os Correios. Falhas dessa integração são apresentadas ao operador.

## Conferências e recuperação

- `StatusPedido` precisa devolver vínculo exato, faturada S, cancelada diferente
  de S e exatamente uma NF-e de saída com status 006, protocolo e chave válida.
- `ConsultarNF` confirma chave, pedido, modelo 55, saída, número, série e data.
  Cancelamento, denegação, inutilização e divergências bloqueiam geração.
- O serviço local precisa ser Mini Envios e a transportadora Correios usada
  nessa integração. A quantidade de páginas deve coincidir com os volumes.
- A reserva atômica `label_generation_state=none -> processing` impede pedidos
  concorrentes de executar duas gerações. Timeout vira `unknown`; não há repetição
  automática e a interface orienta conferir o painel de fretes.
- Uma recusa explícita do Omie permite nova ação manual. Resposta incompleta ou
  aceitação sem confirmação local mantém a proteção contra repetição.
- Os links recebidos são salvos antes de baixar/montar arquivos. `sources_ready`
  retoma somente a montagem/download, sem repetir `GerarEtiqueta`.
- URLs de arquivos e redirecionamentos precisam usar HTTPS em domínio Omie ou
  Correios, sem credenciais na URL. Downloads têm limite de 20 MB e validam PDF.
- Folhas grandes, como A4 com várias etiquetas, não são reduzidas silenciosamente
  a 100 × 150: a montagem bloqueia e preserva o original para conferência do layout.
  A adaptação dessa variante precisa de um PDF original real como evidência.
- O arquivo final é servido por rota autenticada, com perfil ativo, acesso RLS ao
  pedido e consistência da chave/status local. Sem bucket público ou links de
  acesso permanentes. A rota GET não gera etiquetas.
- Sincronizar frete preserva o serviço dos Correios selecionado; o código interno
  `codigo_tipo_entrega` do Omie não substitui o código do serviço Mini Envios.

Migrations: `20261111162254_shipping_labels.sql` e
`20261111165333_authenticated_shipping_label_storage.sql`. O backend usa a sessão
do operador para ler/gravar PDFs; não exige `SUPABASE_SERVICE_ROLE_KEY` na expedição.
RLS permite ler arquivos somente com perfil ativo e caminho correspondente a um
pedido não cancelado e à chave de sua etiqueta. Apenas admin/gestor/operador podem
inserir ou atualizar; consulta pode ler. Não há permissão de exclusão nem acesso
anônimo. Nenhuma política de outras tabelas é alterada.

## Validação

Testes automatizados cobrem NF-e, vínculo, cancelamento, chave/dígito, permissão,
reserva concorrente, timeout, download, formato e quantidade de páginas.
`scripts/verify-label-pdf.py` renderiza a demonstração com PDFium, extrai texto com
pypdf e decodifica as barras renderizadas usando padrões independentes do ReportLab,
conferindo o CODE128 e seu checksum. A demonstração contém dados fictícios e é
marcada sem valor postal. Não representa uma geração real validada nos Correios.
O primeiro teste do operador precisa confirmar o PDF original real devolvido pelo
Omie, o layout final e a leitura na impressora térmica, antes da postagem.

Na correção do armazenamento autenticado, foi baixado o PDF já gerado do pedido
1146, sem nova solicitação de etiqueta, e montado o arquivo com a NF-e 1243. O
original individual (aproximadamente 105 × 130 mm) é compatível com a composição
em 100 × 150 mm. O layout real foi renderizado e conferido.

## Fontes oficiais consultadas

- [API Frete: GerarEtiqueta](https://api.omie.com.br/docs/apis/produtos/frete)
- [API NFConsultar: ConsultarNF](https://api.omie.com.br/docs/apis/produtos/nfconsultar)
- [Fluxo Correios no Omie](https://ajuda.omie.com.br/pt-BR/articles/8967327-cotacao-de-fretes-no-omie-correios)
- [Geração no painel de fretes e anexo ao pedido](https://ajuda.omie.com.br/pt-BR/articles/11564507-cotacao-de-frete-gerando-a-etiqueta-para-o-pacote)
