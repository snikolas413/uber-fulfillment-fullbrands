import { generateShippingLabelAction } from "@/app/expedicao/label-actions";

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
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) {
    return json(400, "Confirme um pedido válido para preparar a etiqueta.");
  }
  // Reuse all session, active-role, invoice and durable-claim checks.
  // This route never bypasses the existing server action or repeats generation.
  const result = await generateShippingLabelAction(body.id, true);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
