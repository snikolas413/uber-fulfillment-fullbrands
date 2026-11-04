"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, BadgeCheck, CheckCircle2, Clock3, Copy, LoaderCircle,
  Mail, Plus, RefreshCw, Search, Shield, UserRoundPlus, UsersRound,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Role = "admin" | "gestor" | "operador" | "consulta";
type UserRecord = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  full_name: string;
  role: Role;
  is_active: boolean;
};

const roleLabels: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  operador: "Operador",
  consulta: "Consulta",
};

function formatDate(value: string | null) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(value));
}

export function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("operador");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const invokeAdmin = useCallback(async (body: Record<string, unknown>) => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.functions.invoke("admin-users", { body });
    if (error) {
      let message = error.message || "Não foi possível concluir a operação.";
      const context = error.context as Response | undefined;
      if (context && typeof context.json === "function") {
        try {
          const payload = await context.json() as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // Keep the SDK error message.
        }
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(String(data.error));
    return data;
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await invokeAdmin({ action: "list_users" });
      setUsers(Array.isArray(data?.users) ? data.users as UserRecord[] : []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }, [invokeAdmin]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      user.full_name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term)
    );
  }, [search, users]);

  const activeCount = users.filter((user) => user.is_active).length;
  const pendingCount = users.filter((user) => !user.email_confirmed_at).length;

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    setInviteUrl("");
    setCopied(false);
    try {
      const data = await invokeAdmin({
        action: "invite_user",
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        role,
      });
      setInviteUrl(String(data.inviteUrl || ""));
      setSuccessMessage("Convite criado. Copie o link e encaminhe ao colaborador por um canal seguro.");
      setEmail("");
      setFullName("");
      setRole("operador");
      await loadUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível criar o convite.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(user: UserRecord, nextRole: Role) {
    if (nextRole === user.role) return;
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await invokeAdmin({ action: "update_user", userId: user.id, role: nextRole });
      setSuccessMessage("Perfil atualizado.");
      await loadUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível atualizar o perfil.");
      await loadUsers();
    } finally {
      setSaving(false);
    }
  }

  async function handleActiveChange(user: UserRecord) {
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await invokeAdmin({ action: "update_user", userId: user.id, isActive: !user.is_active });
      setSuccessMessage(user.is_active ? "Acesso desativado." : "Acesso ativado.");
      await loadUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível alterar o acesso.");
      await loadUsers();
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setErrorMessage("Não foi possível copiar automaticamente. Selecione e copie o link manualmente.");
    }
  }

  return (
    <div className="user-admin-page">
      <div className="eyebrow"><span className="eyebrow-line" /> CONTROLE DE ACESSO</div>
      <div className="user-admin-heading">
        <div>
          <h1>Gestão de usuários</h1>
          <p className="page-lead">Convide colaboradores e controle os níveis de acesso à operação.</p>
        </div>
        <button type="button" className="secondary-button user-refresh" onClick={() => void loadUsers()} disabled={loading || saving}>
          <RefreshCw size={14} /> Atualizar lista
        </button>
      </div>

      <section className="user-stat-grid" aria-label="Resumo de usuários">
        <article className="user-stat-card"><span className="user-stat-icon"><UsersRound size={18} /></span><div><strong>{users.length}</strong><small>Contas cadastradas</small></div></article>
        <article className="user-stat-card"><span className="user-stat-icon user-stat-green"><BadgeCheck size={18} /></span><div><strong>{activeCount}</strong><small>Acessos ativos</small></div></article>
        <article className="user-stat-card"><span className="user-stat-icon user-stat-amber"><Clock3 size={18} /></span><div><strong>{pendingCount}</strong><small>Aguardando convite</small></div></article>
      </section>

      {errorMessage && <div className="user-feedback user-feedback-error" role="alert"><AlertCircle size={16} />{errorMessage}</div>}
      {successMessage && <div className="user-feedback user-feedback-success" role="status"><CheckCircle2 size={16} />{successMessage}</div>}

      <section className="panel user-invite-panel">
        <div className="panel-heading"><div><span className="section-kicker">NOVO ACESSO</span><h2>Convidar colaborador</h2></div><span className="panel-icon"><UserRoundPlus size={18} /></span></div>
        <p className="panel-description">O colaborador recebe um link individual para confirmar o e-mail e definir a própria senha.</p>
        <form className="user-invite-form" onSubmit={handleInvite}>
          <div className="user-field"><label htmlFor="invite-name">Nome completo</label><input id="invite-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nome do colaborador" minLength={2} maxLength={120} required /></div>
          <div className="user-field"><label htmlFor="invite-email">E-mail corporativo</label><input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@fullbrands.com.br" maxLength={254} required /></div>
          <div className="user-field"><label htmlFor="invite-role">Perfil de acesso</label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="operador">Operador</option><option value="gestor">Gestor</option><option value="consulta">Consulta</option><option value="admin">Administrador</option></select></div>
          <button type="submit" className="primary-button user-invite-submit" disabled={saving}>{saving ? <LoaderCircle className="auth-spinner" size={16} /> : <Plus size={16} />}{saving ? "Gerando convite..." : "Gerar convite"}</button>
        </form>
        {inviteUrl && (
          <div className="invite-link-box">
            <div className="invite-link-heading"><Mail size={16} /><strong>Link de convite gerado</strong></div>
            <p>Este link é individual e permite concluir a configuração da conta. Encaminhe-o diretamente ao colaborador por um canal corporativo seguro.</p>
            <div className="invite-copy-row"><input value={inviteUrl} readOnly aria-label="Link individual do convite" onFocus={(event) => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={() => void handleCopyInvite()}><Copy size={14} />{copied ? "Copiado" : "Copiar link"}</button></div>
            <small>O acesso permanece inativo até a confirmação do convite e a liberação por um administrador.</small>
          </div>
        )}
      </section>

      <section className="panel user-list-panel">
        <div className="user-list-heading">
          <div><span className="section-kicker">ACESSOS DO SISTEMA</span><h2>Colaboradores cadastrados</h2></div>
          <label className="user-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome ou e-mail" /></label>
        </div>
        <div className="user-table-wrap">
          <table className="user-table">
            <thead><tr><th>Colaborador</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th>Ações</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="user-table-empty"><LoaderCircle className="auth-spinner" size={18} /> Carregando usuários...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={5} className="user-table-empty">Nenhum usuário encontrado.</td></tr>
              ) : filteredUsers.map((user) => {
                const isSelf = user.id === currentUserId;
                const pending = !user.email_confirmed_at;
                const statusLabel = pending ? "Convite pendente" : user.is_active ? "Ativo" : "Inativo";
                return (
                  <tr key={user.id}>
                    <td><div className="user-person"><span className="user-person-avatar">{user.full_name.trim().slice(0, 1).toUpperCase() || "U"}</span><span><strong>{user.full_name}{isSelf ? " · Você" : ""}</strong><small>{user.email}</small></span></div></td>
                    <td><select className="user-role-select" value={user.role} disabled={saving || isSelf} onChange={(event) => void handleRoleChange(user, event.target.value as Role)} aria-label={"Perfil de " + user.full_name}>{Object.entries(roleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td>
                    <td><span className={"user-status " + (pending ? "user-status-pending" : user.is_active ? "user-status-active" : "user-status-inactive")}><span />{statusLabel}</span></td>
                    <td className="user-last-seen">{formatDate(user.last_sign_in_at)}</td>
                    <td><button type="button" className={"user-action-button " + (user.is_active ? "user-action-disable" : "user-action-enable")} disabled={saving || isSelf || pending} onClick={() => void handleActiveChange(user)}>{user.is_active ? "Desativar" : "Ativar"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="user-table-footnote"><Shield size={14} /> Contas inativas não conseguem acessar os módulos operacionais. Sua conta administradora é protegida contra desativação nesta tela.</div>
      </section>
    </div>
  );
}
