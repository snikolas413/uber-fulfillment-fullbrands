import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OmieRequestPausedError } from "@/lib/omie/request-control";

export async function acquireOmieRequest(options?: { waitForBusy?: boolean }) {
  const lease = randomUUID();
  const db = createSupabaseAdminClient();
  const deadline = Date.now() + 125_000;
  // Contention with another operator/operation is a wait, not an order error.
  // Only reserve locally again; no Omie request is retried here.
  while (true) {
    const { data, error } = await db.rpc("acquire_omie_request", { p_lease: lease });
    if (error || !data || typeof data.granted !== "boolean") {
      throw new OmieRequestPausedError(Date.now() + 61_000, "Não foi possível verificar a proteção da API. Nenhuma chamada ao Omie foi feita.");
    }
    if (!data.granted) {
      const { data: control, error: controlError } = await db.from("omie_api_control")
        .select("paused_until").eq("singleton", true).single();
      const retryAt = Date.parse(data.retry_at);
      if (options?.waitForBusy === false || controlError || !control || Date.parse(control.paused_until) > Date.now() || Date.now() >= deadline) {
        throw new OmieRequestPausedError(Number.isFinite(retryAt) ? retryAt : Date.now() + 120_000);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    return { lease, waitMs: Math.max(0, Math.min(1_000, Number(data.wait_ms) || 0)) };
  }
}

export async function finishOmieRequest(lease: string, pause: number) {
  const { data, error } = await createSupabaseAdminClient().rpc("finish_omie_request", { p_lease: lease, p_pause_seconds: pause });
  if (error || data !== true) throw new Error("Não foi possível finalizar a reserva da API Omie.");
}
