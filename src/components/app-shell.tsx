"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, ClipboardList, FileText, LayoutDashboard, LogOut,
  Settings2, Truck, Users
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const navigation = [
  { label: "Visão geral", href: "/", icon: LayoutDashboard },
  { label: "Destinatários", href: "/destinatarios", icon: Users },
  { label: "Pedidos", href: "/pedidos", icon: ClipboardList },
  { label: "Faturamento", href: "/faturamento", icon: FileText },
  { label: "Expedição", href: "/expedicao", icon: Truck },
  { label: "Histórico", href: "/historico", icon: Activity },
];

const authPaths = ["/login", "/esqueci-senha", "/redefinir-senha", "/acesso-negado"];

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();

  if (authPaths.includes(pathname) || pathname.startsWith("/auth/")) return <>{children}</>;

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/" className="brand-lockup" aria-label="SuppleyTech, página inicial">
          <Image src="/brand/suppleytech-logo.png" alt="SuppleyTech" width={167} height={82} priority />
        </Link>
        <div className="workspace-label">OPERAÇÃO</div>
        <nav className="main-nav" aria-label="Navegação principal">
          {navigation.map(({ label, href, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href} className={`nav-link ${active ? "nav-link-active" : ""}`}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                {active && <span className="active-dot" />}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        <Link href="/configuracoes" className={`nav-link settings-link ${pathname.startsWith("/configuracoes") ? "nav-link-active" : ""}`}>
          <Settings2 size={18} /><span>Configurações</span>
        </Link>
        <div className="sidebar-footer">
          <span className="connection-indicator" />
          <div><strong>Conta autenticada</strong><small>Acesso interno protegido</small></div>
        </div>
        <button type="button" className="sidebar-logout" onClick={handleSignOut}>
          <LogOut size={16} /> Sair do sistema
        </button>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>SuppleyTech</span><span className="breadcrumb-separator">/</span><strong>Uber Fulfillment</strong></div>
          <div className="topbar-right">
            <span className="environment-pill"><span /> AMBIENTE INTERNO</span>
            <div className="user-avatar" aria-label="Full Brands">FB</div>
          </div>
        </header>
        <div className="page-content">{children}</div>
        <footer className="app-footer"><span>SUPPLEYTECH</span><span>Operação Uber · FULL BRANDS</span><span>Versão inicial 0.2.0</span></footer>
      </main>
    </div>
  );
}
