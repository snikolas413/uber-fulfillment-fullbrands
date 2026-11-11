import { redirect } from "next/navigation";
import { MapPin, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OmieActionButton } from "@/components/omie-action-button";
import { LabelButton } from "./label-button";

export const dynamic = "force-dynamic";

type ShipmentRecord = { carrier_id: string | null; tracking_code: string | null; tracking_url: string | null; estimated_delivery_date: string | null; package_count: number | null; service_modality: string | null; status: string; label_storage_path: string | null; label_generation_state: string; freight_amount: number | null };
type InvoiceRecord = { omie_invoice_number: string | null; access_key: string | null; status: string };
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
  if (status === "billing_pending") return "Conferir confirmação da NF-e";
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
    .select("id, status, created_at, recipients(full_name), delivery_addresses(city, state, postal_code), shipments(carrier_id, tracking_code, tracking_url, estimated_delivery_date, package_count, service_modality, status, label_storage_path, label_generation_state, freight_amount), invoices(omie_invoice_number, access_key, status)")
    .in("status", ["billing_pending", "billed", "shipping_pending", "label_ready", "shipped"])
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = ((data ?? []) as unknown as ShippingRow[]).filter(row => row.status !== "billing_pending" ||
    ["billing_submitted", "billing_unknown"].includes(firstRelation(row.invoices)?.status ?? "") || Boolean(firstRelation(row.invoices)?.access_key));
  const withTracking = rows.filter((row) => Boolean(firstRelation(row.shipments)?.tracking_code)).length;
  const labelsReady = rows.filter((row) => Boolean(firstRelation(row.shipments)?.label_storage_path)).length;
  const canGenerate = ["admin", "gestor", "operador"].includes(profile.role);

  return (
    <div className="shipping-page">
      <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> LOGÍSTICA E DISTRIBUIÇÃO</div><h1>Expedição</h1><p className="page-lead">Acompanhe etiquetas, rastreamento e situação dos envios por destinatário.</p></div><span className="history-access"><ShieldCheck size={14} /> {canGenerate ? "Operação" : "Consulta"}</span></section>
      <section className="orders-notice"><div className="orders-notice-icon"><Truck size={17} /></div><div><strong>Etiqueta Correios com chave da NF-e</strong><p>Após o faturamento, gere a etiqueta do Omie com os dados e o código de barras da NF-e em um PDF de 100 × 150 mm. Confira a prévia e imprima em tamanho real (100%). A reimpressão usa o arquivo já salvo.</p></div></section>
      <section className="orders-stats">
        <article className="recipient-stat"><span className="recipient-stat-icon"><PackageCheck size={17} /></span><div><strong>{rows.length}</strong><small>Pedidos na expedição</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><MapPin size={17} /></span><div><strong>{withTracking}</strong><small>Com código de rastreio</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><Truck size={17} /></span><div><strong>{labelsReady}</strong><small>Etiquetas armazenadas</small></div></article>
      </section>
      <section className="panel orders-panel">
        <div className="recipient-toolbar"><div><span className="section-kicker">FILA DE EXPEDIÇÃO</span><h2>Envios e rastreamento</h2></div></div>
        {error ? <div className="recipient-alert recipient-alert-error">Não foi possível consultar os envios.</div> : rows.length ? (
          <div className="orders-table-wrap"><table className="orders-table">
            <thead><tr><th>DESTINATÁRIO</th><th>LOCAL DE ENTREGA</th><th>NF-E</th><th>RASTREAMENTO</th><th>PREVISÃO / FRETE</th><th>STATUS</th><th>AÇÕES</th></tr></thead>
            <tbody>{rows.map((row) => {
              const shipment = firstRelation(row.shipments);
              const invoice = firstRelation(row.invoices);
              const address = row.delivery_addresses;
              return <tr key={row.id}>
                <td><strong>{row.recipients?.full_name ?? "Destinatário indisponível"}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(row.created_at))}</small></td>
                <td>{address ? `${address.city}/${address.state} · ${address.postal_code}` : "Endereço indisponível"}</td>
                <td>{invoice?.omie_invoice_number || "—"}</td>
                <td>{shipment?.tracking_code ? <span><strong>{shipment.tracking_code}</strong>{shipment.tracking_url ? <small><a href={shipment.tracking_url} target="_blank" rel="noreferrer">Acompanhar entrega</a></small> : null}</span> : "Aguardando código"}</td>
                <td><strong>{shipment?.estimated_delivery_date ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(shipment.estimated_delivery_date + "T12:00:00")) : "—"}</strong><small>{shipment?.freight_amount != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(shipment.freight_amount)) : "Frete não informado"}</small><small>{shipment?.package_count ? `${shipment.package_count} volume(s)` : ""}</small></td>
                <td><span className={`order-status order-status-${row.status}`}>{shippingLabel(row.status)}</span></td>
                <td><LabelButton id={row.id} canGenerate={canGenerate && !["processing", "unknown"].includes(shipment?.label_generation_state ?? "none")} ready={shipment?.label_generation_state === "ready" && Boolean(shipment.label_storage_path)} />
                  {["processing", "unknown"].includes(shipment?.label_generation_state ?? "") && <small role="status">Geração em andamento ou sem confirmação. Confira o painel de fretes no Omie antes de solicitar outra etiqueta.</small>}
                  <OmieActionButton fulfillmentId={row.id} kind="sync-shipping" size="small" />
                </td>
              </tr>;
            })}</tbody>
          </table></div>
        ) : <div className="recipient-empty"><span className="recipient-empty-icon"><Truck size={24} /></span><strong>Nenhum envio na fila</strong><p>Os pedidos faturados aparecem aqui. Use “Sincronizar frete” para trazer os dados de expedição já registrados no Omie.</p></div>}
      </section>
    </div>
  );
}
