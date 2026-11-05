import "server-only";

import Redis from "ioredis";

let client: Redis | null = null;

export function getOmieMfaRedis() {
  if (client) return client;
  const url = process.env.OMIE_MFA_REDIS_URL;
  if (!url) throw new Error("Canal seguro de MFA não configurado no servidor.");
  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2000),
  });
  client.on("error", () => {
    // Never log connection strings or message payloads.
  });
  return client;
}

export function mfaResponseKey(challengeId: string) {
  return `omie:mfa:response:${challengeId}`;
}
