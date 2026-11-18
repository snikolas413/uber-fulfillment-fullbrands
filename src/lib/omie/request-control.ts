// One outbound request at a time, no automatic replay, bounded successful-read cache.
const cachedReads = new Set(["ListarClientes", "ConsultarCliente", "ConsultarProduto", "ListarImpostosCenario", "SimularImpostos"]);
const freshReads = new Set(["ConsultarPedido", "StatusPedido", "ConsultarNF", "ObterRastreio"]);
const READ_WINDOW_MS = 61_000;
const MAX_ENTRIES = 500;

export class OmieRequestPausedError extends Error {
  constructor(public readonly retryAt: number, reason?: string, public readonly requestStarted = false) {
    super((reason ? reason + " " : "") + "Integração pausada para proteger o acesso ao Omie. Tente novamente após " +
      new Date(retryAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + ". O pedido não será reenviado automaticamente.");
  }
}

export function pauseSeconds(error: unknown) {
  const details = error as { httpStatus?: number; retryAfterSeconds?: number; code?: string; message?: string; name?: string } | null;
  const message = (details?.code ?? "") + " " + (details?.message ?? "");
  const upstream = details?.retryAfterSeconds ?? 0;
  const seconds = Number(/aguarde\s+(\d+)\s+segundos?/i.exec(message)?.[1] ?? 0);
  const minutes = Number(/(?:aguarde|bloquead[oa].*?)\s*(\d+)\s+minutos?/i.exec(message)?.[1] ?? 0);
  const blocked = details?.httpStatus === 425 || /(?:^|\W)425(?:\W|$)|consumo indevido|api bloqueada|temporariamente bloquead|api.*blocked/i.test(message);
  // REDUNDANT and business refusals concern this request/order, not the company API.
  if (!blocked && /redundant|redundante/i.test(message)) return 0;
  const status = details?.httpStatus ?? 0;
  // Omie documents HTTP 500 as business/parameter validation, unlike 503.
  const unavailable = [401, 403, 406, 408, 429].includes(status) || status > 500 ||
    error instanceof TypeError || ["AbortError", "TimeoutError"].includes(details?.name ?? "");
  if (!blocked && !unavailable && upstream <= 0) return 0;
  return Math.min(86_400, Math.max(blocked ? 1_800 : 61, upstream, seconds + 1, minutes * 60 + 1));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ":" + stable(item)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

export function createOmieRequestControl({ acquire, finish, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }: {
  acquire: (options?: { waitForBusy?: boolean }) => Promise<{ lease: string; waitMs: number }>;
  finish: (lease: string, pause: number) => Promise<void>;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
}) {
  let queue = Promise.resolve();
  let pausedUntil = 0;
  const cache = new Map<string, { until: number; value: unknown }>();
  const reads = new Map<string, number>();
  const trim = <T>(map: Map<string, T>) => { while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!); };

  return function controlled<T>(endpoint: string, method: string, params: Record<string, unknown>, request: () => Promise<T>, options?: { background?: boolean }): Promise<T> {
    const key = endpoint + ":" + method + ":" + stable(params);
    type Turn = { ready: true; value: T } | { ready: false; until: number };
    return (async () => {
      while (true) {
        const task = queue.then(async (): Promise<Turn> => {
          if (pausedUntil > now()) throw new OmieRequestPausedError(pausedUntil);
          const cached = cache.get(key);
          if (cachedReads.has(method) && cached && cached.until > now()) return { ready: true, value: structuredClone(cached.value) as T };
          cache.delete(key);
          // Fresh checks after writes must never use a stale order or invoice snapshot.
          // Wait BEFORE making the new call, rather than causing REDUNDANT and retrying it.
          const readWait = (reads.get(key) ?? 0) - now();
          if (readWait > 0 && options?.background) throw new OmieRequestPausedError(now() + readWait, "Aguardando a janela desta consulta.");
          // Release the scheduling turn while this ID cools down. Another order
          // may use the API; this call rechecks the window before acquiring a lease.
          if (readWait > 0) return { ready: false, until: now() + readWait };
          const reservation = await acquire({ waitForBusy: !options?.background });
          if (reservation.waitMs > 0) await wait(reservation.waitMs);
          let result: T;
          try {
            result = await request();
          } catch (error) {
            const seconds = pauseSeconds(error);
            if (seconds > 0) { pausedUntil = now() + seconds * 1000; cache.clear(); }
            // A failed request is never replayed. A redundant read only delays the
            // same request key; another order can proceed immediately.
            const message = error instanceof Error ? error.message : "";
            if (/redundant|redundante/i.test(message + " " + (error as { code?: string } | null)?.code)) {
              const seconds = Number(/aguarde\s+(\d+)\s+segundos?/i.exec(message)?.[1] ?? 60);
              reads.set(key, now() + Math.max(61, seconds + 1) * 1000); trim(reads);
            }
            try { await finish(reservation.lease, seconds); }
            catch { pausedUntil = Math.max(pausedUntil, now() + 120_000); throw new OmieRequestPausedError(pausedUntil, message, true); }
            if (seconds > 0) throw new OmieRequestPausedError(pausedUntil, message || "Falha na comunicação com o Omie.", true);
            throw error;
          }
          try { await finish(reservation.lease, 0); }
          catch {
            pausedUntil = now() + 120_000;
            throw new OmieRequestPausedError(pausedUntil, "A resposta chegou, mas não foi possível liberar a reserva da integração. Confira o pedido antes de repetir.", true);
          }
          if (cachedReads.has(method)) {
            cache.set(key, { until: now() + READ_WINDOW_MS, value: structuredClone(result) });
            trim(cache);
          }
          if (freshReads.has(method)) { reads.set(key, now() + READ_WINDOW_MS); trim(reads); }
          return { ready: true, value: result };
        });
        queue = task.then(() => undefined, () => undefined);
        const turn = await task;
        if (turn.ready) return turn.value;
        await wait(Math.max(0, turn.until - now()));
      }
    })();
  };
}
