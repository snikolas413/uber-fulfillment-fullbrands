import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
export const metadata: Metadata = {
  title: "Uber Fulfillment | SuppleyTech",
  description: "Gestão de pedidos, faturamento e expedição da operação Uber pela FULL BRANDS."
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><AppShell>{children}</AppShell></body></html>;
}
