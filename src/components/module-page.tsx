import type { ReactNode } from "react";
import { ArrowLeft, Clock3 } from "lucide-react";
import Link from "next/link";
export function ModulePage({ eyebrow, title, lead, icon, message }: {
  eyebrow: string; title: string; lead: string; icon: ReactNode; message: string;
}) {
  return <div className="module-page">
    <div className="eyebrow"><span className="eyebrow-line"/> {eyebrow}</div>
    <h1>{title}</h1><p className="page-lead">{lead}</p>
    <section className="module-card"><span className="metric-icon">{icon}</span><h2>Estrutura inicial pronta</h2>
      <p>{message}</p><div className="module-note"><Clock3 size={14}/> Módulo em implementação</div>
    </section>
    <Link href="/" className="text-link back-link"><ArrowLeft size={15}/> Voltar à visão geral</Link>
  </div>;
}
