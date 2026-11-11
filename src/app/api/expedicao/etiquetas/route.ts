import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mergeLabelPdfs, MAX_BATCH_BYTES } from "@/lib/omie/merge-label-pdfs";
import { validNfeKey } from "@/lib/omie/shipping-invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  // Reverse proxies can expose an internal http URL while the browser uses https.
  let sameHost = false;
  try { sameHost = new URL(request.headers.get("origin") ?? "").host === (request.headers.get("host") ?? new URL(request.url).host); } catch { /* Missing or malformed origin is rejected. */ }
  if (!sameHost) return new Response("Origem não permitida.", { status: 403 });
  const db = await createSupabaseServerClient();
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return new Response("Sessão expirada.", { status: 401 });
  const { data: profile } = await db.from("user_profiles").select("is_active").eq("id", auth.user.id).maybeSingle();
  if (!profile?.is_active) return new Response("Acesso negado.", { status: 403 });
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 10000) return new Response("Lote inválido.", { status: 400 });
    const body = await request.json();
    if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > 100 || body.ids.some((id: unknown) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return new Response("Selecione de 1 a 100 pedidos válidos.", { status: 400 });
    const ids: string[] = [...new Set<string>(body.ids)];
    const { data, error } = await db.from("fulfillments")
      .select("id,status,shipments(label_generation_state,label_invoice_key,label_storage_path),invoices(access_key,status)").in("id", ids);
    if (error || !data || data.length !== ids.length) return new Response("Não foi possível acessar todos os pedidos selecionados.", { status: 403 });
    const first = <T,>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value;
    const files: Uint8Array[] = []; let total = 0;
    for (const id of ids) {
      const row = data.find(item => item.id === id);
      const shipment = row ? first(row.shipments) : null;
      const invoice = row ? first(row.invoices) : null;
      const key = shipment?.label_invoice_key ?? "";
      if (!row || row.status === "cancelled" || shipment?.label_generation_state !== "ready" || !validNfeKey(key) || !invoice || invoice.access_key !== key || invoice.status !== "006" || shipment.label_storage_path !== `${id}/${key}/etiqueta-nfe-v1.pdf`) return new Response("Um pedido está sem etiqueta confirmada ou com situação fiscal divergente. Atualize a lista antes de imprimir.", { status: 409 });
      const { data: file, error: downloadError } = await db.storage.from("shipping-labels").download(shipment.label_storage_path);
      if (downloadError || !file) return new Response("Não foi possível ler uma etiqueta do lote. Os arquivos individuais continuam salvos.", { status: 409 });
      total += file.size;
      if (total > MAX_BATCH_BYTES) return new Response("O lote excede 20 MB. Divida a seleção.", { status: 413 });
      files.push(new Uint8Array(await file.arrayBuffer()));
    }
    const bytes = await mergeLabelPdfs(files);
    return new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="etiquetas-correios-nfe-lote.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Não foi possível montar o PDF do lote.", { status: 400 });
  }
}
