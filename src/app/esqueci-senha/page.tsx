"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = new URL("/auth/callback?next=/redefinir-senha", window.location.origin).toString();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
      if (error) {
        setErrorMessage("Não foi possível solicitar a recuperação. Verifique a configuração de e-mail ou tente novamente.");
      } else {
        setMessage("Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.");
      }
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
        <div className="auth-kicker">RECUPERAÇÃO DE ACESSO</div>
        <h1>Redefinir senha</h1>
        <p className="auth-description">Informe o e-mail da sua conta para receber as instruções de recuperação.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="email">E-mail cadastrado</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          {message && <div className="auth-success" role="status">{message}</div>}
          {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="auth-spinner" size={17} /> : <Mail size={16} />}
            {loading ? "Enviando..." : "Enviar instruções"}
          </button>
        </form>
        <Link href="/login" className="auth-back"><ArrowLeft size={15} /> Voltar ao login</Link>
      </section>
      <footer className="auth-footer">SUPPLEYTECH · UBER FULFILLMENT</footer>
    </main>
  );
}
