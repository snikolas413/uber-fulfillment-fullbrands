# Autenticação e liberação de acesso

## Modelo de acesso
- Não há cadastro público na aplicação.
- E-mail e senha são autenticados pelo Supabase Auth.
- O primeiro administrador é cadastrado inicialmente no painel do Supabase e promovido no perfil user_profiles.
- Novos colaboradores são convidados pela tela Configurações > Usuários e permissões.
- Novos perfis começam inativos. O colaborador confirma o e-mail e define a própria senha; depois, um administrador ativo libera o acesso operacional.
- O proxy Next.js valida a sessão e consulta user_profiles.is_active antes de liberar as páginas privadas.
- As políticas RLS aplicam as permissões no PostgreSQL. Esconder uma página não substitui RLS.

## Preparação no Supabase Dashboard
1. Em Authentication > URL Configuration, configure Site URL como https://uber-fulfillment-fullbrands.onrender.com.
2. Adicione https://uber-fulfillment-fullbrands.onrender.com/redefinir-senha à lista de Redirect URLs.
3. Em Authentication > Providers > Email, mantenha login por senha habilitado.
4. Desative signups públicos. Convites administrativos continuam sendo feitos pela Auth Admin API do Edge Function.
5. Para recuperação de senha por e-mail, configure um SMTP próprio em Authentication > SMTP Settings e valide o remetente.

## Primeiro administrador
A conta inicial foi criada em Authentication > Users. O perfil precisa retornar role = admin e is_active = true. Para conferir:

\`\`\`sql
select id, email, role, is_active
from public.user_profiles
where lower(email) = lower('nikolas.alves@fullbrands.com.br');
\`\`\`

Não compartilhe senhas neste repositório ou no chat.

## Gestão de usuários
- A tela administrativa fica em Configurações > Usuários e permissões.
- Apenas administradores ativos podem listar contas, gerar convites, alterar papéis e ativar/desativar colaboradores.
- O link de convite é gerado pelo Edge Function admin-users, exibido uma única vez e deve ser enviado por canal corporativo seguro.
- O link não é armazenado em tabela ou log. A validade segue a configuração de expiração de e-mails do Supabase Auth.
- A ativação só é permitida depois da confirmação do e-mail.
- Papéis: admin (gestão total), gestor (gestão operacional e consultas de auditoria), operador (opera cadastros e processos) e consulta (somente leitura).
- A própria conta administradora não pode ser rebaixada ou desativada pela tela.
- O sistema mantém proteção transacional para impedir que duas ações simultâneas removam o último administrador ativo.
- As contas são desativadas logicamente pelo campo is_active. Nenhum usuário, dado operacional ou histórico é apagado.

## Segurança e variáveis
- O gateway da Edge Function exige JWT válido. A função valida novamente o usuário e exige role = admin e is_active = true.
- A chave secreta Supabase é usada somente na Edge Function, nunca no navegador, nas variáveis NEXT_PUBLIC_* ou no repositório.
- A função usa SUPABASE_SECRET_KEYS (chave nomeada default) ou, em ambientes legados, SUPABASE_SERVICE_ROLE_KEY.
- No Render, mantenha apenas NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para o cliente Supabase.
