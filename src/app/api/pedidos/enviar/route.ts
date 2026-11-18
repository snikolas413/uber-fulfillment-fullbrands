import { sendOrderToOmieAction } from "@/app/pedidos/omie-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const json = (status: number, message: string) => Response.json({ status: "error", message }, { status, headers: { "Cache-Control": "no-store" } });
  let sameHost = false;
  try { sameHost = new URL(request.headers.get("origin") ?? "").host === (request.headers.get("host") ?? new URL(request.url).host); } catch { /* Missing origin is rejected. */ }
  if (!sameHost) return json(403, "Origem não permitida.");
  if (Number(request.headers.get("content-length") ?? 0) > 1000) return json(400, "Pedido inválido.");
  let body;
  try {
    const text = await request.text();
    if (text.length > 1000) return json(400, "Pedido inválido.");
    body = JSON.parse(text);
  } catch { return json(400, "Pedido inválido."); }
  if (!body || body.confirmed !== true || typeof body.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id) || body.confirmRetry === true) {
    return json(400, "Confirme um pedido válido, sem autorizar nova inclusão.");
  }
  // Reuse all session, active-role, CPF, fiscal and durable-claim checks.
  // This route never bypasses the existing server action or enables retries.
  const result = await sendOrderToOmieAction(body.id, false);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
