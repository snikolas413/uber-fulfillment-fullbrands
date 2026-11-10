// Only repeat reads after Omie's explicit REDUNDANT cooldown. Never repeat writes.
const readMethods = new Set(["ConsultarPedido", "ConsultarCliente", "ListarClientes", "StatusPedido"]);

export async function withRedundantReadRetry<T>(
  method: string,
  request: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!readMethods.has(method) || !(error instanceof Error)) throw error;
    const code = "code" in error ? String(error.code) : "";
    if (!/REDUNDANT/i.test(code + " " + error.message)) throw error;
    const seconds = /aguarde\s+(\d+)\s+segundos?/i.exec(error.message)?.[1];
    const delay = Number(seconds);
    if (!seconds || !Number.isInteger(delay) || delay < 1 || delay > 60) throw error;
    await wait((delay + 1) * 1000);
    return request();
  }
}
