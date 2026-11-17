import "server-only";
import type { PostalAddress } from "./import-address";

// Only CEPs and public postal responses are cached, never recipient data.
const cache = new Map<string, {expires: number; result: Promise<PostalAddress | null>}>();
let unavailableUntil = 0;
export async function lookupPostalAddress(cep: string): Promise<PostalAddress | null> {
  if (!/^\d{8}$/.test(cep)) return null;
  const hit = cache.get(cep);
  if (hit && hit.expires > Date.now()) return hit.result;
  if (unavailableUntil > Date.now()) throw new Error("Postal lookup temporarily unavailable");
  if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
  const result = (async () => {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {signal: AbortSignal.timeout(4000), cache: "no-store"});
    if (!response.ok) throw new Error("Postal lookup unavailable");
    const data = await response.json();
    if (data.erro) return null;
    if (typeof data.cep !== "string" || data.cep.replace(/\D/g, "") !== cep || typeof data.localidade !== "string" || !data.localidade ||
      typeof data.uf !== "string" || !/^[A-Z]{2}$/.test(data.uf) || typeof data.logradouro !== "string" || typeof data.bairro !== "string") throw new Error("Invalid postal response");
    return {cep, logradouro:data.logradouro,bairro:data.bairro,localidade:data.localidade,uf:data.uf};
  })();
  const entry = {expires: Date.now()+24*60*60_000,result};
  cache.set(cep,entry);
  try {
    const value = await result;
    if (!value) entry.expires = Date.now()+60_000;
    return value;
  } catch (error) {
    if (cache.get(cep) === entry) cache.delete(cep);
    // An outage must not cost four seconds for every row of a large file.
    unavailableUntil = Date.now() + 30_000;
    throw error;
  }
}
