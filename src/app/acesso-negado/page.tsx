import Image from "next/image";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function AccessDeniedPage() {
  return (
    <main className="auth-page">
      <section className="auth-card auth-denied-card">
        <div className="auth-brand"><Image src="/brand/suppleytech-logo.png" alt="SuppleyTech" width={175} height={82} priority /></div>
        <div className="auth-denied-icon"><ShieldAlert size={25} /></div>
        <div className="auth-kicker">ACESSO NÃO LIBERADO</div>
        <h1>Conta aguardando aprovação</h1>
        <p className="auth-description">Sua conta ainda não está ativa para esta operação. Peça ao administrador para liberar seu perfil.</p>
        <Link href="/login" className="auth-submit auth-submit-link">Voltar ao login</Link>
      </section>
      <footer className="auth-footer">SUPPLEYTECH · UBER FULFILLMENT</footer>
    </main>
  );
}
