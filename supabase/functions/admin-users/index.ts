import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const APP_ORIGINS = new Set([
  "https://uber-fulfillment-fullbrands.onrender.com",
  "http://localhost:3000",
]);
const ROLES = ["admin", "gestor", "operador", "consulta"] as const;
type Role = (typeof ROLES)[number];

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getSecretKey(): string {
  const named = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (named) {
    try {
      const parsed = JSON.parse(named) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Fall through to the legacy variable.
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("Supabase secret key is not configured.");
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null): Response {
  const allowedOrigin = origin && APP_ORIGINS.has(origin)
    ? origin
    : "https://uber-fulfillment-fullbrands.onrender.com";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  entityId: string,
  action: string,
  beforeSummary: Record<string, unknown> | null,
  afterSummary: Record<string, unknown>,
) {
  const { error } = await admin.from("audit_logs").insert({
    actor_id: actorId,
    entity_type: "user_profile",
    entity_id: entityId,
    action,
    before_summary: beforeSummary,
    after_summary: afterSummary,
    source: "admin_users_edge_function",
  });
  if (error) console.error("Unable to write admin audit event:", error.message);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !APP_ORIGINS.has(origin)) {
    return jsonResponse({ error: "Origem não autorizada." }, 403, origin);
  }
  if (request.method === "OPTIONS") return jsonResponse({ ok: true }, 200, origin);
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return jsonResponse({ error: "Sessão não encontrada. Entre novamente." }, 401, origin);
  }

  try {
    const projectUrl = Deno.env.get("SUPABASE_URL");
    if (!projectUrl) throw new Error("Supabase URL is not configured.");

    const admin = createClient(projectUrl, getSecretKey(), {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(tokenMatch[1]);
    if (authError || !authData.user) {
      return jsonResponse({ error: "Sessão inválida ou expirada. Entre novamente." }, 401, origin);
    }

    const actorId = authData.user.id;
    const { data: actorProfile, error: actorError } = await admin
      .from("user_profiles")
      .select("id, role, is_active")
      .eq("id", actorId)
      .maybeSingle();

    if (actorError || !actorProfile || actorProfile.role !== "admin" || actorProfile.is_active !== true) {
      return jsonResponse({ error: "Somente administradores ativos podem gerenciar usuários." }, 403, origin);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Requisição inválida." }, 400, origin);
    }

    if (body.action === "list_users") {
      const authUsers = [];
      for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        authUsers.push(...data.users);
        if (data.users.length < 1000) break;
      }

      const ids = authUsers.map((item) => item.id);
      const { data: profiles, error: profilesError } = ids.length
        ? await admin.from("user_profiles")
            .select("id, email, full_name, role, is_active, created_at, updated_at")
            .in("id", ids)
        : { data: [], error: null };

      if (profilesError) throw profilesError;
      const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const users = authUsers.map((item) => {
        const profile = profileById.get(item.id);
        return {
          id: item.id,
          email: item.email ?? profile?.email ?? "",
          email_confirmed_at: item.email_confirmed_at ?? null,
          last_sign_in_at: item.last_sign_in_at ?? null,
          created_at: item.created_at,
          full_name: profile?.full_name ?? item.user_metadata?.full_name ?? "Usuário",
          role: profile?.role ?? "operador",
          is_active: profile?.is_active === true,
        };
      }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

      return jsonResponse({ users }, 200, origin);
    }

    if (body.action === "invite_user") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
      const role = body.role;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new HttpError(400, "Informe um e-mail válido.");
      }
      if (fullName.length < 2 || fullName.length > 120) {
        throw new HttpError(400, "Informe o nome do colaborador (de 2 a 120 caracteres).");
      }
      if (!isRole(role)) throw new HttpError(400, "Selecione um perfil válido.");

      const redirectTo = "https://uber-fulfillment-fullbrands.onrender.com/redefinir-senha";
      const { data, error } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { data: { full_name: fullName }, redirectTo },
      });

      if (error) {
        const duplicate = /already|registered|exists/i.test(error.message);
        throw new HttpError(duplicate ? 409 : 400, duplicate
          ? "Este e-mail já possui uma conta. Atualize a lista ou verifique o cadastro existente."
          : "Não foi possível gerar o convite. Verifique as configurações de autenticação do projeto.");
      }

      const userId = data.user?.id;
      const inviteUrl = data.properties?.action_link;
      if (!userId || !inviteUrl) throw new Error("Supabase did not return a complete invitation link.");

      const { error: profileError } = await admin.from("user_profiles").upsert({
        id: userId,
        email,
        full_name: fullName,
        role,
        is_active: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (profileError) throw profileError;

      await writeAudit(admin, actorId, userId, "invite_created", null, { role, is_active: false });
      return jsonResponse({
        ok: true,
        inviteUrl,
        message: "Convite criado. Compartilhe o link por um canal corporativo seguro.",
      }, 200, origin);
    }

    if (body.action === "update_user") {
      const userId = body.userId;
      const role = body.role;
      const hasActiveValue = Object.prototype.hasOwnProperty.call(body, "isActive");
      const isActive = body.isActive;
      const fullName = typeof body.fullName === "string" ? body.fullName.trim() : undefined;

      if (!isUuid(userId)) throw new HttpError(400, "Usuário inválido.");
      if (role !== undefined && !isRole(role)) throw new HttpError(400, "Perfil inválido.");
      if (hasActiveValue && typeof isActive !== "boolean") {
        throw new HttpError(400, "Situação de acesso inválida.");
      }
      if (fullName !== undefined && (fullName.length < 2 || fullName.length > 120)) {
        throw new HttpError(400, "O nome deve ter entre 2 e 120 caracteres.");
      }

      const { data: current, error: currentError } = await admin
        .from("user_profiles")
        .select("id, email, full_name, role, is_active")
        .eq("id", userId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw new HttpError(404, "Usuário não encontrado.");

      const nextRole = isRole(role) ? role : current.role;
      const nextActive = typeof isActive === "boolean" ? isActive : current.is_active;

      if (userId === actorId && (nextRole !== "admin" || nextActive !== true)) {
        throw new HttpError(409, "Sua própria conta administradora não pode ser rebaixada ou desativada por esta tela.");
      }

      if (nextActive && current.is_active !== true) {
        const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
        if (authUserError) throw authUserError;
        if (!authUser.user.email_confirmed_at) {
          throw new HttpError(409, "O colaborador precisa aceitar o convite e confirmar o e-mail antes da ativação.");
        }
      }

      const isRemovingActiveAdmin = current.role === "admin" &&
        current.is_active === true &&
        (nextRole !== "admin" || nextActive !== true);

      if (isRemovingActiveAdmin) {
        const { count, error: countError } = await admin
          .from("user_profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("is_active", true);
        if (countError) throw countError;
        if ((count ?? 0) <= 1) {
          throw new HttpError(409, "O sistema precisa manter pelo menos um administrador ativo.");
        }
      }

      const update: Record<string, unknown> = {
        role: nextRole,
        is_active: nextActive,
        updated_at: new Date().toISOString(),
      };
      if (fullName !== undefined) update.full_name = fullName;

      const { data: updated, error: updateError } = await admin
        .from("user_profiles")
        .update(update)
        .eq("id", userId)
        .select("id, email, full_name, role, is_active")
        .single();
      if (updateError) throw updateError;

      await writeAudit(admin, actorId, userId, "profile_updated", {
        role: current.role,
        is_active: current.is_active,
        full_name: current.full_name,
      }, {
        role: updated.role,
        is_active: updated.is_active,
        full_name: updated.full_name,
      });

      return jsonResponse({ ok: true, user: updated }, 200, origin);
    }

    throw new HttpError(400, "Ação não reconhecida.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError
      ? error.message
      : "Não foi possível concluir a operação. Tente novamente ou consulte o administrador do sistema.";
    if (!(error instanceof HttpError)) console.error("admin-users failure:", error);
    return jsonResponse({ error: message }, status, origin);
  }
});
