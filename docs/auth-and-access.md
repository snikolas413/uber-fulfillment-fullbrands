# Autenticação e liberação de acesso

## Modelo de acesso
- Não há cadastro público na aplicação.
- E-mail e senha são autenticados pelo Supabase Auth.
- Novas contas são criadas com perfil `operador`, porém começam **inativas**.
- Um administrador precisa ativar o perfil e atribuir um dos papéis: `admin`, `gestor`, `operador` ou `consulta`.
- O proxy Next.js valida os claims da sessão e consulta `user_profiles.is_active` antes de liberar as páginas privadas.
- As políticas RLS aplicam as mesmas permissões no PostgreSQL. Esconder uma página não substitui RLS.

## Preparação obrigatória no Supabase Dashboard
1. Abra Authentication > URL Configuration.
2. Configure Site URL como `https://uber-fulfillment-fullbrands.onrender.com`.
3. Adicione `https://uber-fulfillment-fullbrands.onrender.com/auth/callback` à lista de Redirect URLs.
4. Em Authentication > Providers > Email, mantenha login por senha habilitado.
5. Desative signups públicos. Contas devem ser criadas apenas pelo administrador no painel Supabase.

## Primeiro administrador
O conector de administração do Supabase desta sessão não oferece criação/invitação de usuários. O primeiro acesso precisa ser criado pelo responsável no Dashboard:
1. Abra Authentication > Users e escolha Add user > Create new user.
2. Informe o e-mail corporativo e uma senha inicial exclusiva. Confirme o usuário no Dashboard.
3. No SQL Editor, execute o comando abaixo substituindo o e-mail pelo endereço criado:

```sql
update public.user_profiles
set role = 'admin',
    is_active = true,
    updated_at = now()
where lower(email) = lower('SEU-EMAIL-CORPORATIVO')
returning id, email, role, is_active;
```

A consulta precisa retornar exatamente um perfil com `role = 'admin'` e `is_active = true`. Não compartilhe senha neste repositório ou no chat.

## Criar e ativar usuários seguintes
1. Crie o usuário em Authentication > Users.
2. No SQL Editor, atribua um papel e ative somente após validar o e-mail:

```sql
update public.user_profiles
set role = 'operador',
    is_active = true,
    updated_at = now()
where lower(email) = lower('EMAIL-DO-COLABORADOR')
returning id, email, role, is_active;
```

Papéis:
- `admin`: gestão total de perfis e dados operacionais.
- `gestor`: leitura e operação dos dados; leitura de auditoria e eventos.
- `operador`: cadastro e atualização de destinatários, pedidos e expedição.
- `consulta`: leitura dos dados operacionais.

## Recuperação de senha
A tela de recuperação usa Supabase Auth. Para enviar e-mails de recuperação de forma confiável em produção, configure um SMTP próprio em Authentication > SMTP Settings e valide o domínio/remetente.

## Variáveis no Render
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

A chave publishable pode estar no cliente, porque as políticas RLS protegem os dados. Nunca coloque chaves `service_role` ou `sb_secret` em variáveis `NEXT_PUBLIC_*` nem no Git.
