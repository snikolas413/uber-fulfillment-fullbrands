# Importação de destinatários

Na tela Destinatários, use **Importar arquivo**, selecione o arquivo, revise a prévia editável e confirme as linhas aptas. O cadastro individual continua disponível.

## Arquivos

- Excel `.xlsx`: primeira aba; `.xls` deve ser convertido para `.xlsx`.
- CSV com vírgula ou ponto e vírgula; TSV com tabulação.
- Até 5.000 destinatários por arquivo e 10 MB. A prévia mostra 50 linhas por página.
- Cabeçalho na primeira linha. O modelo recomenda `cpf`, `full_name`, `phone_number`, `email`, `endereco`, `bairro`, `cidade`, `estado`, `codigo_postal`. São obrigatórias as colunas `cpf`, `full_name`, `endereco`, `codigo_postal`; as demais podem ser completadas pela consulta postal ou na prévia.
- O modelo para download tem exatamente essas nove colunas, nessa ordem. Informe rua, número e complemento juntos em `endereco`, como `Rua Afonso 13 casa 2`.
- Acentos e espaços nos cabeçalhos são normalizados: `endereço` e `código postal` são aceitos.
- Colunas opcionais: `numero`, `complemento`. Um número explícito tem prioridade; a repetição do mesmo número no endereço é separada quando inequívoca. Números diferentes não são substituídos.
- Formate CPF, telefone e CEP como **texto** no Excel. CPFs com exatamente 10 dígitos e CEPs com exatamente 7 recebem um zero à esquerda. Outros tamanhos não são completados. Notação científica é convertida apenas quando representa um inteiro seguro. As correções aparecem na prévia antes da validação e da verificação de duplicidades.
- Também são aceitos cabeçalhos como `nome completo`, `telefone`, `logradouro`, `município`, `UF` e `CEP`.

## Revisão e gravação

Linhas liberadas mostram somente **Pronto para importar** na coluna de validação,
sem detalhes de ajustes ou avisos. Pendências continuam mostrando o motivo.

A separação de endereço reconhece marcadores como `n.º`, `nº`, `#`, dois-pontos,
travessões e separadores, além de números como `0012-A`, `123/A` e `123/2`.
Zeros à esquerda, letras, barras e complemento são preservados. Um número
preenchido em coluna própria não é substituído por outro extraído do endereço.
Números em nomes de ruas e quilometragem de rodovias não são usados como número
do imóvel quando a identificação é ambígua.

`Rua Afonso 13 casa 2` é separado em `Rua Afonso`, `13`, `casa 2`. Endereços que não permitem identificar o número ficam pendentes até correção na prévia. Revise sempre a separação automática.

CPF precisa ter 11 dígitos, CEP 8, UF brasileira válida e endereço completo. Telefone e e-mail são opcionais no cadastro; quando preenchidos precisam ser válidos (telefone de 10 a 13 dígitos com DDD). A ausência gera um aviso. O e-mail continua necessário antes de preparar um pedido. O CPF é validado pelo tamanho, sem verificação dos dígitos verificadores.

## Tratamento e conferência do endereço

O importador remove espaços e caracteres invisíveis, reconhece UF por nome completo,
separa município e UF (`São Gonçalo/RJ`), reconhece `nº`, `número`, `S/N`, números
com letras e complementos como `ap`, `casa`, `bloco`, `lote` e `quadra`. Nomes com
um trecho final duplicado de forma inequívoca são normalizados. Dados longos não
são cortados; limites que podem causar rejeição no Omie geram avisos antes de preparar o pedido, sem bloquear o cadastro.

Após a leitura, o servidor consulta o ViaCEP enviando somente o CEP. Município e UF
são corrigidos quando a consulta e os dados informados são compatíveis. Bairro e
logradouro vazios podem ser preenchidos; valores divergentes são preservados e
destacados. Número do imóvel nunca é inventado nem obtido por CEP. Não se trata
de uma validação de que a residência existe: o endereço cadastrado continua pendente
de validação.

A prévia separa **Todas**, **Prontas para importar** e **Somente pendências**.
Avisos e ajustes automáticos ficam nos detalhes de cada linha. A confirmação
manual aparece somente quando a consulta encontra conflito de rua, município/UF
ou um CEP inexistente. Campos obrigatórios ausentes e formatos inválidos continuam
exigindo correção e não podem ser liberados por uma caixa de confirmação.

Abreviações de logradouro e títulos, acentos e pequenas diferenças de grafia
são comparados automaticamente. Diferenças de bairro são avisos, preservando o
valor informado; não substituem a conferência de rua e município. Limites mais
restritos do Omie são avisados no cadastro e continuam exigidos na preparação do
pedido. Dados existentes não são sobrescritos pelo arquivo.

Se o serviço postal estiver temporariamente indisponível, a importação pode
continuar quando os campos obrigatórios estiverem completos. O endereço permanece
sem certificação postal, com aviso explícito; indisponibilidade não significa CEP
inexistente. Após falhas, novas consultas externas ficam suspensas por 30 segundos
para evitar repetir timeouts em todas as linhas. Consultas em andamento do mesmo
CEP compartilham a requisição e respostas válidas ficam em cache por 24 horas.

São aceitas até 5000 linhas/10 MB, em etapas de 50 linhas. Cada etapa consulta os
CPFs existentes em uma única operação e grava no máximo quatro destinatários
distintos por vez, usando a RPC transacional já existente. A conferência postal
também mantém no máximo quatro consultas simultâneas. A ordem dos resultados
acompanha o arquivo. O servidor sempre refaz a validação, inclusive para linhas
marcadas como revisadas na prévia.

A prévia e a listagem de destinatários mostram 50 linhas por página. Editar contato
não invalida a conferência do endereço. Editar endereço exige nova conferência,
disponível na própria linha. A revisão em lote prioriza endereços ainda não
conferidos, com conflito ou cuja consulta estava indisponível.

Não há restrição única de CPF no modelo atual: a consulta agrupada não garante exclusão de duplicatas entre duas importações simultâneas do mesmo arquivo. O processamento dentro de uma etapa separa CPFs repetidos antes de gravar.

O resultado mostra cadastros concluídos, ignorados e erros por linha. As linhas concluídas ficam bloqueadas para evitar reenvio pela mesma prévia. Em interrupções, confira o cadastro antes de continuar; a nova tentativa verifica novamente a existência do CPF. Arquivos são lidos no navegador; o arquivo original não é armazenado no servidor.

## Relatório de pendências

Esse relatório cobre somente as linhas do arquivo que não foram cadastradas.
Para extrair a base já cadastrada, use o relatório abaixo.

Quando existem linhas bloqueadas, a prévia oferece **Baixar relatório de pendências (CSV)**. O arquivo inclui `linha_arquivo`, `situacao`, `motivo` e as nove colunas do modelo, com os dados atuais da prévia e o endereço reunido em `endereco`.

O relatório é atualizado após a importação e inclui validações locais, CPFs duplicados, erros no cadastro e linhas não processadas. Em interrupção de uma etapa, diferencia resultado não confirmado (a linha pode ter sido gravada antes da perda da resposta) de linha não enviada. Cadastros confirmados são excluídos do relatório. Linhas válidas que ainda não foram submetidas não são tratadas como erro.

O download é feito no navegador e não armazena o arquivo no servidor. Abra o CSV importando CPF, telefone e CEP como texto para preservar zeros à esquerda. Antes de reenviar dados corrigidos, remova as colunas de diagnóstico se preferir usar somente a estrutura original; o importador também aceita colunas extras.

## Relatório de destinatários cadastrados

Na tela **Destinatários**, clique em **Exportar destinatários (CSV)** para baixar
a base acessível ao seu perfil. Com uma busca preenchida, o botão muda para
**Exportar busca (CSV)** e usa os mesmos critérios da pesquisa por nome, CPF,
telefone, e-mail, município, UF e CEP. Limpe a busca para exportar toda a base.

Use **Data inicial** e **Data final** em **Período de cadastro para exportação**
para extrair apenas os destinatários cadastrados nesse intervalo. Os limites
incluem os dias completos no horário de São Paulo, inclusive o último dia (até
antes da meia-noite seguinte). A data considerada é a de criação do cadastro,
não a de alteração do endereço. Pode preencher somente uma data; sem datas,
exporta toda a base. **Limpar período** remove as datas. Busca e período podem
ser combinados. Períodos invertidos ou datas inválidas são rejeitados antes da
extração. As datas também aparecem no nome do arquivo baixado.

O relatório consulta o banco em páginas e não fica limitado aos registros
carregados na tela. São considerados os destinatários cadastrados até o início
da extração. Cada destinatário aparece uma vez, com seu endereço mais recente
(desempate por ID), contatos, situação da validação e datas de cadastro/atualização
no horário de São Paulo. Destinatários sem endereço também são incluídos.

O CSV usa UTF-8 e separador `;`, preserva acentos e contém as colunas do modelo
com rua, número e complemento separados, além do ID, status do endereço e datas.
Ao importar no Excel, defina CPF, telefone e CEP como **texto** para manter zeros
à esquerda; abrir o CSV diretamente no Excel pode convertê-los em números.

A extração exige sessão e perfil ativo, respeita RLS e não modifica cadastros.
Falhas na consulta impedem o download para não entregar um relatório incompleto.

## Validação

`npm test` cobre parsing de CSV/TSV/XLSX, aspas, cabeçalhos, limites, zeros à esquerda, separação de endereços e validação dos campos. `npm run typecheck`, `npm run lint` e `npm run build` verificam a integração com o aplicativo.

Para homologar no ambiente publicado: entrar como operador ativo, importar um lote pequeno conhecido, revisar os endereços, confirmar os cadastros e conferir a listagem e o histórico. Reimportar o mesmo lote deve ignorar os CPFs cadastrados. Um usuário de consulta não deve ter acesso à importação. Essa homologação exige uma sessão autenticada e dados autorizados.
