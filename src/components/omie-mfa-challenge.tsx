"use client";
import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";

type Challenge = { jobId: string; fulfillmentId: string; challengeId: string; expiresAt: string };

export function OmieMfaChallenge() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/omie-mfa", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { challenges?: Challenge[] };
        if (active) setChallenge(data.challenges?.[0] ?? null);
      } catch { /* polling failures do not expose authentication data */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!challenge) return;
    const delay = Date.parse(challenge.expiresAt) - Date.now();
    const timer = window.setTimeout(() => {
      setChallenge(null);
      setCode("");
      setError("O prazo do código terminou. O robô precisará solicitar outro.");
    }, Math.max(delay, 0));
    return () => window.clearTimeout(timer);
  }, [challenge]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/omie-mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível encaminhar o código.");
      setCode(""); setChallenge(null);
      setNotice("Código encaminhado ao robô. Aguardando confirmação do Omie.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao enviar o código.");
    } finally { setBusy(false); }
  }

  if (!challenge) return notice || error ? <section className="omie-mfa-notice" role="status"><strong>{error ? "Autenticação precisa de atenção" : "Código encaminhado"}</strong><p>{error || notice}</p></section> : null;

  return <div className="recipient-modal-backdrop" role="presentation">
    <section className="recipient-modal omie-mfa-modal" role="dialog" aria-modal="true" aria-labelledby="omie-mfa-title">
      <div className="recipient-modal-header">
        <div><span className="section-kicker">AUTENTICAÇÃO DO ERP</span><h2 id="omie-mfa-title">Confirme o acesso ao Omie</h2><p>O Omie enviou um código para o e-mail cadastrado na conta do robô.</p></div>
        <KeyRound size={21} />
      </div>
      <form className="recipient-form" onSubmit={submit}>
        <div className="omie-mfa-status"><ShieldCheck size={16}/><span><strong>Aguardando código de segurança do Omie</strong><small>O código será usado uma única vez e não ficará salvo no sistema.</small></span></div>
        <label className="omie-mfa-label" htmlFor="omie-mfa-code">Código recebido por e-mail</label>
        <input id="omie-mfa-code" className="omie-mfa-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={event => setCode(event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0,10))} placeholder="Digite o código" required autoFocus />
        {error && <div className="recipient-alert recipient-alert-error">{error}</div>}
        <div className="recipient-form-actions"><button type="submit" className="primary-button" disabled={busy || code.length < 4}>{busy ? <><LoaderCircle className="auth-spinner" size={15}/> Enviando...</> : <><ShieldCheck size={15}/> Confirmar código</>}</button></div>
      </form>
    </section>
  </div>;
}
