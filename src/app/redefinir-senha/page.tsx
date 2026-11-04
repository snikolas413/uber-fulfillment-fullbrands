"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");

    if (password.length < 12) {
      setErrorMessage("Use uma senha com pelo menos 12 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage("Não foi possível atualizar a senha. Solicite um novo link de recuperação.");
        return;
      }
      setMessage("Senha alterada. Você já pode entrar com a nova senha.");
      setPassword("");
      setConfirmPassword("");
      window.setTimeout(() => {
        router.replace("/login");
        router.refresh();
      }, 1200);
    } catch {
      setErrorMessage("Não foi possível conectar ao serviço de autenticação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><Image src="/brand/suppleytech-logo.png" alt="SuppleyTech" width={175} height={82} priority /></div>
        <div className="auth-kicker">SEGURANÇA DA CONTA</div>
        <h1>Crie uma nova senha</h1>
        <p className="auth-description">Defina uma senha forte com pelo menos 12 caracteres.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="password">Nova senha</label>
          <input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required />
          <label htmlFor="confirmPassword">Confirme a nova senha</label>
          <input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required />
          {message && <div className="auth-success" role="status"><CheckCircle2 size={16} /> {message}</div>}
          {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="auth-spinner" size={17} /> : <LockKeyhole size={16} />}
            {loading ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
        <Link href="/login" className="auth-back"><ArrowLeft size={15} /> Voltar ao login</Link>
      </section>
      <footer className="auth-footer">SUPPLEYTECH · UBER FULFILLMENT</footer>
    </main>
  );
}
