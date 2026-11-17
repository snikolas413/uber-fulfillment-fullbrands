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

`Rua Afonso 13 casa 2` é separado em `Rua Afonso`, `13`, `casa 2`. Endereços que não permitem identificar o número ficam pendentes até correção na prévia. Revise sempre a separação automática.

CPF precisa ter 11 dígitos, CEP 8, UF brasileira válida e endereço completo. Telefone e e-mail são opcionais no cadastro; quando preenchidos precisam ser válidos (telefone de 10 a 13 dígitos com DDD). A ausência gera um aviso. O e-mail continua necessário antes de preparar um pedido. O CPF é validado pelo tamanho, sem verificação dos dígitos verificadores.

## Tratamento e conferência do endereço

O importador remove espaços e caracteres invisíveis, reconhece UF por nome completo,
separa município e UF (`São Gonçalo/RJ`), reconhece `nº`, `número`, `S/N`, números
com letras e complementos como `ap`, `casa`, `bloco`, `lote` e `quadra`. Nomes com
um trecho final duplicado de forma inequívoca são normalizados. Dados longos não
são cortados; limites que podem causar rejeição no Omie geram avisos para revisão.

Após a leitura, o servidor consulta o ViaCEP enviando somente o CEP. Município e UF
são corrigidos quando a consulta e os dados informados são compatíveis. Bairro e
logradouro vazios podem ser preenchidos; valores divergentes são preservados e
destacados. Número do imóvel nunca é inventado nem obtido por CEP. Não se trata
de uma validação de que a residência existe: o endereço cadastrado continua pendente
de validação.

CEP inexistente, consulta indisponível ou divergências não descartam o arquivo.
Corrija os campos e use **Conferir endereços novamente**, ou marque **Conferi
manualmente os dados e as divergências desta linha** após verificar os dados.
Essa confirmação não dispensa campos obrigatórios e formatos válidos. Alterar um
campo invalida a confirmação e a conferência anteriores. A confirmação é individual,
sem aprovação indiscriminada do arquivo. A prévia apresenta os ajustes e avisos;
o servidor repete a normalização/conferência antes de gravar.

A consulta usa até quatro requisições simultâneas e compartilha resultados de CEPs
repetidos em cache limitado, sem armazenar dados de destinatários nesse cache.
O progresso aparece por etapa; **Parar após etapa atual** permite interromper a
conferência ou o cadastro sem perder etapas concluídas. Arquivos grandes podem
demorar mais conforme a quantidade de CEPs diferentes e a disponibilidade do serviço.

CPFs repetidos no arquivo ficam bloqueados após a primeira ocorrência. CPFs já cadastrados são ignorados; o arquivo não atualiza cadastros existentes. A consulta ao banco é repetida no servidor antes de cada cadastro. Não há restrição única de CPF no modelo atual: a consulta não garante exclusão de duplicatas entre duas importações simultâneas. Evite importar o mesmo lote em sessões paralelas até a definição de uma regra global de unicidade.

O navegador envia etapas de até 20 linhas. O servidor valida sessão, perfil ativo e permissão (`admin`, `gestor`, `operador`), valida os dados novamente e utiliza `save_recipient_with_address`, preservando RLS e auditoria. Cada destinatário e seu endereço são gravados na mesma transação da RPC existente. Uma falha não desfaz etapas já concluídas.

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
