const OMIE_BASE_URL = process.env.OMIE_API_BASE_URL ?? "https://app.omie.com.br/api/v1";
export class OmieConfigurationError extends Error {
 constructor(message = "Credenciais Omie não configuradas no servidor.") { super(message); this.name = "OmieConfigurationError"; }
}
export class OmieApiError extends Error {
 constructor(message: string, public readonly code?: string) { super(message); this.name = "OmieApiError"; }
}
type OmieResponse<T> = T & { faultstring?: string; faultcode?: string };
/** Cliente genérico server-side. Não importar em componentes client. */
export async function callOmie<T>(endpoint: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
 const appKey=process.env.OMIE_APP_KEY; const appSecret=process.env.OMIE_APP_SECRET;
 if (!appKey||!appSecret) throw new OmieConfigurationError();
 if (!endpoint.startsWith("/")||endpoint.includes("..")) throw new Error("Endpoint Omie inválido.");
 const response=await fetch(`${OMIE_BASE_URL}${endpoint}`,{
  method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
  body:JSON.stringify({call:method,app_key:appKey,app_secret:appSecret,param:[params]}),
  cache:"no-store",signal:AbortSignal.timeout(30_000)
 });
 if(!response.ok) throw new OmieApiError(`Omie respondeu com HTTP ${response.status}.`);
 const payload=await response.json() as OmieResponse<T>;
 if(payload.faultstring) throw new OmieApiError(payload.faultstring,payload.faultcode);
 return payload;
}
