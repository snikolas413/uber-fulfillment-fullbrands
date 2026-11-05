import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getOperator() {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return null;
  const { data: profile, error } = await supabase.from("user_profiles")
    .select("role,is_active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) return null;
  return { user: auth.user, supabase };
}

async function waitForPrivateChannel(channel: ReturnType<Awaited<ReturnType<typeof createSupabaseServerClient>>["channel"]>) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out.")), 8000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        reject(new Error("Realtime private channel unavailable."));
      }
    });
  });
}

export async function GET() {
  const operator = await getOperator();
  if (!operator) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("omie_shipping_jobs")
    .select("id,fulfillment_id,challenge_id,challenge_expires_at")
    .eq("requested_by", operator.user.id).eq("status", "awaiting_mfa")
    .order("created_at", { ascending: false }).limit(1);
  if (error) return NextResponse.json({ error: "Não foi possível consultar a autenticação pendente." }, { status: 503 });
  const now = Date.now();
  const challenges = (data ?? []).filter(row => row.challenge_id && row.challenge_expires_at && Date.parse(row.challenge_expires_at) > now)
    .map(row => ({ jobId: row.id, fulfillmentId: row.fulfillment_id, challengeId: row.challenge_id, expiresAt: row.challenge_expires_at }));
  return NextResponse.json({ challenges }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });

  const body = await request.json().catch(() => null) as { challengeId?: unknown; code?: unknown } | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9]{4,10}$/.test(code))
    return NextResponse.json({ error: "Informe o código de segurança válido." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: job, error } = await admin.from("omie_shipping_jobs")
    .select("id,status,challenge_expires_at,mfa_attempts")
    .eq("challenge_id", challengeId).eq("requested_by", operator.user.id)
    .eq("status", "awaiting_mfa").maybeSingle();
  if (error || !job) return NextResponse.json({ error: "Esta solicitação não está mais ativa." }, { status: 409 });
  if (!job.challenge_expires_at || Date.parse(job.challenge_expires_at) <= Date.now()) {
    await admin.from("omie_shipping_jobs").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ error: "O código expirou. O robô precisará solicitar outro." }, { status: 410 });
  }
  if (job.mfa_attempts >= 5) return NextResponse.json({ error: "Limite de tentativas atingido." }, { status: 429 });

  const { data: sessionData, error: sessionError } = await operator.supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    return NextResponse.json({ error: "Sessão expirada. Entre novamente no sistema." }, { status: 401 });
  }

  const { data: updatedJob, error: updateError } = await admin.from("omie_shipping_jobs").update({
    status: "mfa_submitted",
    mfa_attempts: job.mfa_attempts + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("status", "awaiting_mfa").select("id").maybeSingle();
  if (updateError || !updatedJob) {
    return NextResponse.json({ error: updateError ? "Não foi possível confirmar o envio." : "Esta solicitação já foi processada." },
      { status: updateError ? 503 : 409 });
  }

  const channel = operator.supabase.channel(`omie:mfa:${challengeId}`, {
    config: { private: true, broadcast: { ack: true, self: false } },
  });
  try {
    await operator.supabase.realtime.setAuth(accessToken);
    await waitForPrivateChannel(channel);
    const sent = await channel.send({
      type: "broadcast",
      event: "mfa_code",
      payload: { challengeId, code },
    });
    if (sent !== "ok") throw new Error("Realtime did not acknowledge the message.");
    return NextResponse.json({ accepted: true }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    await admin.from("omie_shipping_jobs").update({
      status: "failed",
      last_error: "Não foi possível entregar o código pelo canal temporário.",
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("status", "mfa_submitted");
    return NextResponse.json({ error: "Não foi possível entregar o código ao robô. A solicitação foi interrompida com segurança." }, { status: 503 });
  } finally {
    await operator.supabase.removeChannel(channel);
  }
}
