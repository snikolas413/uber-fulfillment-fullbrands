import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withRedundantReadRetry } from "@/lib/omie/read-retry";

const OMIE_API_BASE_URL = (process.env.OMIE_API_BASE_URL ?? "https://app.omie.com.br/api/v1").replace(/\/+$/, "");
const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

type StoredOmieCredentials = {
  appHash: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

type LegacyOmieCredentials = {
  appKey: string;
  appSecret: string;
};

type OmiePayload = Record<string, unknown> & {
  faultstring?: string;
  faultcode?: string;
};

export class OmieConfigurationError extends Error {
  constructor(message = "A integração Omie ainda não está configurada no servidor.") {
    super(message);
    this.name = "OmieConfigurationError";
  }
}

export class OmieApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "OmieApiError";
  }
}

let cachedCredentials: StoredOmieCredentials | null = null;
let credentialsLoadPromise: Promise<StoredOmieCredentials> | null = null;
let refreshPromise: Promise<StoredOmieCredentials> | null = null;

function legacyCredentialsFromEnvironment(): LegacyOmieCredentials | null {
  const appKey = process.env.OMIE_APP_KEY?.trim();
  const appSecret = process.env.OMIE_APP_SECRET?.trim();

  if (!appKey && !appSecret) return null;
  if (!appKey || !appSecret) {
    throw new OmieConfigurationError(
      "Configure OMIE_APP_KEY e OMIE_APP_SECRET juntos no ambiente privado do servidor.",
    );
  }

  return { appKey, appSecret };
}

function validCredentials(value: unknown): value is StoredOmieCredentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.appHash === "string" &&
    candidate.appHash.length > 0 &&
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    typeof candidate.refreshToken === "string" &&
    candidate.refreshToken.length > 0 &&
    typeof candidate.expiresAt === "string" &&
    Number.isFinite(Date.parse(candidate.expiresAt))
  );
}

async function readCredentialsFromVault(): Promise<StoredOmieCredentials | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_omie_credentials");

  if (error) {
    throw new OmieConfigurationError(
      "Não foi possível ler as credenciais Omie armazenadas no Supabase Vault. Verifique a migration de credenciais.",
    );
  }

  if (!data) return null;

  try {
    const parsed: unknown = JSON.parse(String(data));
    return validCredentials(parsed) ? parsed : null;
  } catch {
    throw new OmieConfigurationError("O registro de credenciais Omie no Vault está inválido.");
  }
}

async function writeCredentialsToVault(credentials: StoredOmieCredentials): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("set_omie_credentials", {
    p_secret: JSON.stringify(credentials),
  });

  if (error) {
    throw new OmieConfigurationError(
      "Não foi possível persistir a rotação das credenciais Omie no Supabase Vault.",
    );
  }

  cachedCredentials = credentials;
}

function bootstrapCredentialsFromEnvironment(): StoredOmieCredentials {
  const appHash = process.env.OMIE_APP_HASH?.trim();
  const accessToken = process.env.OMIE_ACCESS_TOKEN?.trim();
  const refreshToken = process.env.OMIE_REFRESH_TOKEN?.trim();
  const issuedAt = process.env.OMIE_ACCESS_TOKEN_ISSUED_AT?.trim();

  if (!appHash || !accessToken || !refreshToken || !issuedAt) {
    throw new OmieConfigurationError(
      "Configure OMIE_APP_HASH, OMIE_ACCESS_TOKEN, OMIE_REFRESH_TOKEN e OMIE_ACCESS_TOKEN_ISSUED_AT no ambiente do servidor, ou use OMIE_APP_KEY e OMIE_APP_SECRET.",
    );
  }

  const issuedAtMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedAtMs)) {
    throw new OmieConfigurationError("OMIE_ACCESS_TOKEN_ISSUED_AT deve ser uma data ISO válida.");
  }

  return {
    appHash,
    accessToken,
    refreshToken,
    expiresAt: new Date(issuedAtMs + TOKEN_LIFETIME_MS).toISOString(),
  };
}

async function loadCredentials(): Promise<StoredOmieCredentials> {
  if (cachedCredentials) return cachedCredentials;
  if (credentialsLoadPromise) return credentialsLoadPromise;

  credentialsLoadPromise = (async () => {
    const stored = await readCredentialsFromVault();
    if (stored) {
      cachedCredentials = stored;
      return stored;
    }

    const bootstrap = bootstrapCredentialsFromEnvironment();
    await writeCredentialsToVault(bootstrap);
    return bootstrap;
  })();

  try {
    return await credentialsLoadPromise;
  } finally {
    credentialsLoadPromise = null;
  }
}

async function refreshCredentials(force = false): Promise<StoredOmieCredentials> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const current = await loadCredentials();
    const expiresAt = Date.parse(current.expiresAt);

    if (!force && expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return current;
    }

    const endpoint = `https://app.omie.com.br/api/portal/apps/${encodeURIComponent(current.appHash)}/refresh-token/`;
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          token: current.accessToken,
          refresh_token: current.refreshToken,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new OmieApiError("Não foi possível renovar o token da integração Omie.");
    }

    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body || body.faultstring) {
      const message = typeof body?.faultstring === "string"
        ? body.faultstring
        : `O Omie recusou a renovação do token (HTTP ${response.status}).`;
      throw new OmieApiError(message, typeof body?.faultcode === "string" ? body.faultcode : undefined, response.status);
    }

    const accessToken = typeof body.token === "string"
      ? body.token
      : typeof body.access_token === "string" ? body.access_token : null;
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;

    if (!accessToken || !refreshToken) {
      throw new OmieApiError("A resposta de renovação do Omie não trouxe o novo par de tokens.");
    }

    const next: StoredOmieCredentials = {
      appHash: current.appHash,
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
    };

    await writeCredentialsToVault(next);
    return next;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function requestOmieBearer(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  accessToken: string,
): Promise<{ response: Response; payload: OmiePayload | null }> {
  const response = await fetch(`${OMIE_API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ call: method, param: [params] }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await response.json().catch(() => null) as OmiePayload | null;
  return { response, payload };
}

async function requestOmieAppKey(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  credentials: LegacyOmieCredentials,
): Promise<{ response: Response; payload: OmiePayload | null }> {
  const response = await fetch(`${OMIE_API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      call: method,
      app_key: credentials.appKey,
      app_secret: credentials.appSecret,
      param: [params],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await response.json().catch(() => null) as OmiePayload | null;
  return { response, payload };
}

function assertOmieSuccess(
  result: { response: Response; payload: OmiePayload | null },
): OmiePayload {
  if (!result.response.ok) {
    throw new OmieApiError(
      typeof result.payload?.faultstring === "string"
        ? result.payload.faultstring
        : `O Omie respondeu com HTTP ${result.response.status}.`,
      typeof result.payload?.faultcode === "string" ? result.payload.faultcode : undefined,
      result.response.status,
    );
  }

  if (!result.payload) {
    throw new OmieApiError("O Omie retornou uma resposta vazia ou inválida.");
  }

  if (result.payload.faultstring) {
    throw new OmieApiError(result.payload.faultstring, result.payload.faultcode);
  }

  return result.payload;
}

/**
 * Cliente server-side da API Omie. Nunca importar em componentes client.
 * Aceita App Key/Secret (modelo tradicional) ou token Bearer com renovação no Vault.
 */
async function callOmieOnce<T extends Record<string, unknown>>(
  endpoint: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!endpoint.startsWith("/") || endpoint.includes("..")) {
    throw new Error("Endpoint Omie inválido.");
  }

  const legacyCredentials = legacyCredentialsFromEnvironment();
  if (legacyCredentials) {
    const result = await requestOmieAppKey(endpoint, method, params, legacyCredentials);
    return assertOmieSuccess(result) as T;
  }

  let credentials = await refreshCredentials();
  let result = await requestOmieBearer(endpoint, method, params, credentials.accessToken);

  if (result.response.status === 401) {
    credentials = await refreshCredentials(true);
    result = await requestOmieBearer(endpoint, method, params, credentials.accessToken);
  }

  return assertOmieSuccess(result) as T;
}

export async function callOmie<T extends Record<string, unknown>>(
  endpoint: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return withRedundantReadRetry(method, () => callOmieOnce<T>(endpoint, method, params));
}

export function getOmieCredentialStatus() {
  const legacyConfigured = Boolean(
    process.env.OMIE_APP_KEY?.trim() && process.env.OMIE_APP_SECRET?.trim(),
  );
  const bearerConfigured = Boolean(
    process.env.OMIE_APP_HASH &&
    (cachedCredentials || (process.env.OMIE_ACCESS_TOKEN && process.env.OMIE_REFRESH_TOKEN)),
  );

  return {
    configured: legacyConfigured || bearerConfigured,
    authentication: legacyConfigured
      ? "App Key/Secret (server-side)"
      : "Bearer token com renovação automática",
    storage: legacyConfigured ? "Variáveis privadas do Render" : "Supabase Vault",
  } as const;
}
