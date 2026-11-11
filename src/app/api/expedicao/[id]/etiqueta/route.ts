import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Pedido inválido.", { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return new Response("Sessão expirada.", { status: 401 });
  const { data: profile } = await db.from("user_profiles").select("is_active").eq("id", auth.user.id).maybeSingle();
  if (!profile?.is_active) return new Response("Acesso negado.", { status: 403 });
  const { data: shipment } = await db.from("shipments").select("label_storage_path,label_invoice_key,label_generation_state").eq("fulfillment_id", id).maybeSingle();
  if (shipment?.label_generation_state !== "ready" || !/^\d{44}$/.test(shipment.label_invoice_key ?? "") || shipment.label_storage_path !== `${id}/${shipment.label_invoice_key}/etiqueta-nfe-v1.pdf`) return new Response("Etiqueta ainda não disponível.", { status: 404 });
  const { data: invoice } = await db.from("invoices").select("access_key,status").eq("fulfillment_id", id).maybeSingle();
  const { data: order } = await db.from("fulfillments").select("status").eq("id", id).maybeSingle();
  if (!order || order.status === "cancelled" || !invoice || invoice.access_key !== shipment.label_invoice_key || invoice.status !== "006") return new Response("Confira a situação fiscal do pedido antes de imprimir.", { status: 409 });
  const { data, error } = await createSupabaseAdminClient().storage.from("shipping-labels").download(shipment.label_storage_path);
  if (error || !data) return new Response("Arquivo da etiqueta indisponível.", { status: 404 });
  return new Response(await data.arrayBuffer(), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="etiqueta-${id}.pdf"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
