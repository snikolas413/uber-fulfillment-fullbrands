export function assertLabelUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    !(url.hostname === "omie.com.br" || url.hostname.endsWith(".omie.com.br") || url.hostname === "correios.com.br" || url.hostname.endsWith(".correios.com.br"))) {
    throw new Error("O Omie retornou um endereço de etiqueta fora dos domínios permitidos. A geração não será repetida; confira o documento no Omie.");
  }
  return url;
}

export async function downloadOmieLabel(value: string): Promise<Uint8Array> {
  let url = assertLabelUrl(value);
  const limit = 20 * 1024 * 1024;
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirecionamento de etiqueta inválido.");
      url = assertLabelUrl(new URL(location, url).href); continue;
    }
    if (!response.ok || !response.body) throw new Error("Não foi possível baixar o PDF da etiqueta. A solicitação no Omie não será repetida.");
    if (Number(response.headers.get("content-length") ?? 0) > limit) throw new Error("O PDF da etiqueta excede 20 MB.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const { value: chunk, done } = await reader.read(); if (done) break;
        total += chunk.length;
        if (total > limit) throw new Error("O PDF da etiqueta excede 20 MB.");
        chunks.push(chunk);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new Error("O documento retornado pelo Omie não é um PDF válido.");
    return bytes;
  }
  throw new Error("O link da etiqueta excedeu o limite de redirecionamentos.");
}
