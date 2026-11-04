import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  const isAdmin = profile?.role === "admin" && profile.is_active === true;

  return (
    <div className="module-page">
      <div className="eyebrow"><span className="eyebrow-line" /> SISTEMA</div>
      <h1>Configurações</h1>
      <p className="page-lead">Gerencie parâmetros do ambiente e permissões de acesso.</p>
      <section className="module-card">
        <span className="metric-icon"><Settings2 size={20} /></span>
        <h2>Ambiente seguro</h2>
        <p>As credenciais de integração permanecem no ambiente seguro do servidor. Nenhuma chave privilegiada é cadastrada ou exibida no navegador.</p>
        <div className="module-note"><ShieldCheck size={14} /> Autenticação Supabase ativa</div>
      </section>
      {isAdmin ? (
        <section className="module-card user-settings-card">
          <div className="user-settings-icon"><UsersRound size={20} /></div>
          <div className="user-settings-copy">
            <span className="section-kicker">ADMINISTRAÇÃO</span>
            <h2>Usuários e permissões</h2>
            <p>Convide colaboradores, atribua perfis e controle a liberação das contas da operação.</p>
          </div>
          <Link href="/configuracoes/usuarios" className="primary-button">Gerenciar usuários <ArrowRight size={15} /></Link>
        </section>
      ) : (
        <section className="module-card"><h2>Gestão de usuários</h2><p>A administração de contas é restrita a usuários com perfil de administrador.</p></section>
      )}
    </div>
  );
}
