# Importação de destinatários

Na tela Destinatários, use **Importar arquivo**, selecione o arquivo, revise a prévia editável e confirme as linhas aptas. O cadastro individual continua disponível.

## Arquivos

- Excel `.xlsx`: primeira aba; `.xls` deve ser convertido para `.xlsx`.
- CSV com vírgula ou ponto e vírgula; TSV com tabulação.
- Até 500 destinatários por arquivo e 5 MB.
- Cabeçalho na primeira linha. Colunas: `cpf`, `full_name`, `phone_number`, `email`, `endereco`, `bairro`, `cidade`, `estado`, `codigo_postal`.
- O modelo para download tem exatamente essas nove colunas, nessa ordem. Informe rua, número e complemento juntos em `endereco`, como `Rua Afonso 13 casa 2`.
- Acentos e espaços nos cabeçalhos são normalizados: `endereço` e `código postal` são aceitos.
- Colunas opcionais: `numero`, `complemento`. Quando `numero` está preenchido, `endereco` é usado como logradouro, sem separação automática.
- Formate CPF, telefone e CEP como **texto** no Excel. Zeros que já foram perdidos no arquivo não são inventados pelo importador.

## Revisão e gravação

`Rua Afonso 13 casa 2` é separado em `Rua Afonso`, `13`, `casa 2`. Endereços que não permitem identificar o número ficam pendentes até correção na prévia. Revise sempre a separação automática.

CPF precisa ter 11 dígitos, CEP 8, telefone de 10 a 13 com DDD, e-mail válido, UF brasileira válida e endereço completo. O CPF é validado pelo tamanho, como no cadastro atual, sem verificação dos dígitos verificadores.

CPFs repetidos no arquivo ficam bloqueados após a primeira ocorrência. CPFs já cadastrados são ignorados; o arquivo não atualiza cadastros existentes. A consulta ao banco é repetida no servidor antes de cada cadastro. Não há restrição única de CPF no modelo atual: a consulta não garante exclusão de duplicatas entre duas importações simultâneas. Evite importar o mesmo lote em sessões paralelas até a definição de uma regra global de unicidade.

O navegador envia etapas de até 20 linhas. O servidor valida sessão, perfil ativo e permissão (`admin`, `gestor`, `operador`), valida os dados novamente e utiliza `save_recipient_with_address`, preservando RLS e auditoria. Cada destinatário e seu endereço são gravados na mesma transação da RPC existente. Uma falha não desfaz etapas já concluídas.

O resultado mostra cadastros concluídos, ignorados e erros por linha. As linhas concluídas ficam bloqueadas para evitar reenvio pela mesma prévia. Em interrupções, confira o cadastro antes de continuar; a nova tentativa verifica novamente a existência do CPF. Arquivos são lidos no navegador; o arquivo original não é armazenado no servidor.

## Validação

`npm test` cobre parsing de CSV/TSV/XLSX, aspas, cabeçalhos, limites, zeros à esquerda, separação de endereços e validação dos campos. `npm run typecheck`, `npm run lint` e `npm run build` verificam a integração com o aplicativo.

Para homologar no ambiente publicado: entrar como operador ativo, importar um lote pequeno conhecido, revisar os endereços, confirmar os cadastros e conferir a listagem e o histórico. Reimportar o mesmo lote deve ignorar os CPFs cadastrados. Um usuário de consulta não deve ter acesso à importação. Essa homologação exige uma sessão autenticada e dados autorizados.
