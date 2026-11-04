# Administração de usuários

## Fluxo
- Somente perfis admin ativos podem listar usuários, gerar convites, atribuir papéis e ativar/desativar contas.
- O convite é criado pelo endpoint Supabase Edge Function admin-users usando a Auth Admin API em ambiente server-side.
- O link gerado é exibido uma única vez na tela administrativa para ser compartilhado por canal corporativo seguro. Não é salvo em tabela, log ou repositório.
- Ao aceitar o convite, o colaborador define a própria senha em /redefinir-senha. A sessão de convite pode abrir essa página mesmo que o perfil ainda esteja inativo.
- O perfil permanece inativo até um administrador liberar o acesso. A ativação é recusada enquanto o e-mail não estiver confirmado.
- Papéis disponíveis: admin, gestor, operador e consulta.
- A própria conta administradora não pode ser rebaixada ou desativada pela tela. O sistema também protege o último administrador ativo no endpoint e por trigger transacional.

## Segurança
- A chave secreta Supabase é usada somente no Edge Function e nunca é enviada ao navegador.
- O gateway exige JWT válido (verify_jwt = true); a função valida novamente a sessão e exige role = admin e is_active = true.
- O gerenciamento administrativo ocorre por meio do endpoint admin-users; não há permissão de listar todos os perfis no navegador.
- Alterações de perfil geram eventos em audit_logs.
- Contas são desativadas de forma lógica pelo campo is_active, sem apagar usuários, dados operacionais ou histórico.

## Configuração
- O projeto Supabase precisa manter a chave secret padrão disponível às Edge Functions (SUPABASE_SECRET_KEYS).
- O endereço de retorno do convite é https://uber-fulfillment-fullbrands.onrender.com/redefinir-senha. Confirme que esse endereço está permitido em Authentication > URL Configuration.
- As alterações da aplicação ficam no branch feat/admin-user-management até revisão e integração. A migration 20261104012000_admin_last_active_guard.sql precisa ser aplicada no projeto antes de depender da proteção transacional no banco.
