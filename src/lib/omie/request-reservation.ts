import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OmieRequestPausedError } from "@/lib/omie/request-control";

export async function acquireOmieRequest() {
  const lease = randomUUID();
  const { data, error } = await createSupabaseAdminClient().rpc("acquire_omie_request", { p_lease: lease });
  if (error || !data || typeof data.granted !== "boolean") {
    throw new OmieRequestPausedError(Date.now() + 61_000, "Não foi possível verificar a proteção da API. Nenhuma chamada ao Omie foi feita.");
  }
  if (!data.granted) {
    const retryAt = Date.parse(data.retry_at);
    throw new OmieRequestPausedError(Number.isFinite(retryAt) ? retryAt : Date.now() + 120_000);
  }
  return { lease, waitMs: Math.max(0, Math.min(1_000, Number(data.wait_ms) || 0)) };
}

export async function finishOmieRequest(lease: string, pause: number) {
  const { data, error } = await createSupabaseAdminClient().rpc("finish_omie_request", { p_lease: lease, p_pause_seconds: pause });
  if (error || data !== true) throw new Error("Não foi possível finalizar a reserva da API Omie.");
}
