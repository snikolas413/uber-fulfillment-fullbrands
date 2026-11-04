"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        setErrorMessage("Não foi possível entrar. Confira o e-mail e a senha ou solicite acesso ao administrador.");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage("Não foi possível conectar ao serviço de autenticação. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <Image src="/brand/suppleytech-logo.png" alt="SuppleyTech" width={175} height={82} priority />
        </div>
        <div className="auth-kicker">AMBIENTE INTERNO · FULL BRANDS</div>
        <h1>Acesse sua conta</h1>
        <p className="auth-description">Entre com as credenciais corporativas liberadas para a operação.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="email">E-mail corporativo</label>
          <input id="email" type="email" autoComplete="username" value={email}
            onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com.br" required />
          <label htmlFor="password">Senha</label>
          <input id="password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" required />
          {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="auth-spinner" size={17} /> : <LockKeyhole size={16} />}
            {loading ? "Entrando..." : "Entrar"}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>
        <div className="auth-links">
          <Link href="/esqueci-senha">Esqueci minha senha</Link>
          <span>O acesso é liberado pelo administrador.</span>
        </div>
      </section>
      <footer className="auth-footer">SUPPLEYTECH · UBER FULFILLMENT</footer>
    </main>
  );
}
