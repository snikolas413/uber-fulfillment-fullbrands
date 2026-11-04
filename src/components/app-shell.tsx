import Image from "next/image";
import Link from "next/link";
import { Activity, ClipboardList, FileText, LayoutDashboard, Settings2, Truck, Users } from "lucide-react";
const nav = [
  { label: "Visão geral", href: "/", icon: LayoutDashboard },
  { label: "Destinatários", href: "/destinatarios", icon: Users },
  { label: "Pedidos", href: "/pedidos", icon: ClipboardList },
  { label: "Faturamento", href: "/faturamento", icon: FileText },
  { label: "Expedição", href: "/expedicao", icon: Truck },
  { label: "Histórico", href: "/historico", icon: Activity }
];
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="app-frame">
    <aside className="sidebar">
      <Link href="/" className="brand-lockup" aria-label="SuppleyTech">
        <Image src="/brand/suppleytech-logo.png" alt="SuppleyTech" width={167} height={82} priority />
      </Link>
      <div className="workspace-label">OPERAÇÃO</div>
      <nav className="main-nav" aria-label="Navegação principal">
        {nav.map(({ label, href, icon: Icon }, i) => <Link key={href} href={href} className={`nav-link ${i === 0 ? "nav-link-active" : ""}`}>
          <Icon size={18} strokeWidth={1.8}/><span>{label}</span>{i === 0 && <span className="active-dot"/>}
        </Link>)}
      </nav>
      <div className="sidebar-spacer"/>
      <Link href="/configuracoes" className="nav-link settings-link"><Settings2 size={18}/><span>Configurações</span></Link>
      <div className="sidebar-footer"><span className="connection-indicator"/><div><strong>Ambiente interno</strong><small>Integrações em configuração</small></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><span>SuppleyTech</span><span className="breadcrumb-separator">/</span><strong>Uber Fulfillment</strong></div>
        <div className="topbar-right"><span className="environment-pill"><span/> DESENVOLVIMENTO</span><div className="user-avatar">FB</div></div>
      </header>
      <div className="page-content">{children}</div>
      <footer className="app-footer"><span>SUPPLEYTECH</span><span>Operação Uber · FULL BRANDS</span><span>Versão inicial 0.1.0</span></footer>
    </main>
  </div>;
}
