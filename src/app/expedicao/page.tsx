import { redirect } from "next/navigation";
import { MapPin, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ShipmentRecord = { tracking_code: string | null; status: string; label_storage_path: string | null; freight_amount: number | null };
type InvoiceRecord = { omie_invoice_number: string | null; access_key: string | null };
type ShippingRow = {
  id: string;
  status: string;
  created_at: string;
  recipients: { full_name: string } | null;
  delivery_addresses: { city: string; state: string; postal_code: string } | null;
  shipments: ShipmentRecord | ShipmentRecord[] | null;
  invoices: InvoiceRecord | InvoiceRecord[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function shippingLabel(status: string) {
  if (status === "billed") return "Faturado · aguardando expedição";
  if (status === "shipping_pending") return "Aguardando etiqueta";
  if (status === "label_ready") return "Etiqueta disponível";
  if (status === "shipped") return "Enviado";
  return status;
}

export default async function ShippingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) redirect("/acesso-negado");

  const { data, error } = await supabase
    .from("fulfillments")
    .select("id, status, created_at, recipients(full_name), delivery_addresses(city, state, postal_code), shipments(tracking_code, status, label_storage_path, freight_amount), invoices(omie_invoice_number, access_key)")
    .in("status", ["billed", "shipping_pending", "label_ready", "shipped"])
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as unknown as ShippingRow[];
  const withTracking = rows.filter((row) => Boolean(row.shipments?.[0]?.tracking_code)).length;
  const labelsReady = rows.filter((row) => Boolean(row.shipments?.[0]?.label_storage_path)).length;

  return (
    <div className="shipping-page">
      <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> LOGÍSTICA E DISTRIBUIÇÃO</div><h1>Expedição</h1><p className="page-lead">Acompanhe etiquetas, rastreamento e situação dos envios por destinatário.</p></div><span className="history-access"><ShieldCheck size={14} /> Consulta</span></section>
      <section className="orders-notice"><div className="orders-notice-icon"><Truck size={17} /></div><div><strong>Correios ainda não conectados à aplicação</strong><p>Esta tela não gera etiquetas nem consulta rastreios. A integração será habilitada depois de validar credenciais, serviço contratado e o fluxo de expedição.</p></div></section>
      <section className="orders-stats">
        <article className="recipient-stat"><span className="recipient-stat-icon"><PackageCheck size={17} /></span><div><strong>{rows.length}</strong><small>Pedidos na expedição</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><MapPin size={17} /></span><div><strong>{withTracking}</strong><small>Com código de rastreio</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Truck size={17} /></span><div><strong>{labelsReady}</strong><small>Etiquetas armazenadas</small></div></article>
      </section>
      <section className="panel orders-panel">
        <div className="recipient-toolbar"><div><span className="section-kicker">FILA DE EXPEDIÇÃO</span><h2>Envios e rastreamento</h2></div></div>
        {error ? <div className="recipient-alert recipient-alert-error">Não foi possível consultar os envios.</div> : rows.length ? (
          <div className="orders-table-wrap"><table className="orders-table">
            <thead><tr><th>DESTINATÁRIO</th><th>LOCAL DE ENTREGA</th><th>NF-E</th><th>RASTREAMENTO</th><th>STATUS</th></tr></thead>
            <tbody>{rows.map((row) => {
              const shipment = firstRelation(row.shipments);
              const invoice = firstRelation(row.invoices);
              const address = row.delivery_addresses;
              return <tr key={row.id}>
                <td><strong>{row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(row.created_at))}</small></td>
                <td>{address ? `${address.city}/${address.state} · ${address.postal_code}` : "Endereço indisponível"}</td>
                <td>{invoice?.omie_invoice_number || "—"}</td>
                <td>{shipment?.tracking_code || "Aguardando código"}</td>
                <td><span className={`order-status order-status-${row.status}`}>{shippingLabel(row.status)}</span></td>
              </tr>;
            })}</tbody>
          </table></div>
        ) : <div className="recipient-empty"><span className="recipient-empty-icon"><Truck size={24} /></span><strong>Nenhum envio na fila</strong><p>Os pedidos faturados e encaminhados à expedição aparecerão aqui quando os registros forem sincronizados.</p></div>}
      </section>
    </div>
  );
}
