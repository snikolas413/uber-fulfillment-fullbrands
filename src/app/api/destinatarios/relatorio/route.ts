import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadRecipientReport, recipientReportCsv, recipientReportPeriod, type RecipientReportPeriod } from "@/lib/recipient-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};

export async function GET(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    const {data:auth,error:authError} = await client.auth.getUser();
    if (authError || !auth.user) return new Response("Sua sessão expirou. Entre novamente.",{status:401,headers});
    const {data:profile,error:profileError} = await client.from("user_profiles").select("is_active").eq("id",auth.user.id).maybeSingle();
    if (profileError || !profile?.is_active) return new Response("Acesso negado.",{status:403,headers});
    const params = new URL(request.url).searchParams;
    const search = params.get("q") ?? "";
    if (search.length > 100) return new Response("Use até 100 caracteres na busca para exportar.",{status:400,headers});
    const start = params.get("start") ?? "", end = params.get("end") ?? "";
    let period: RecipientReportPeriod;
    try { period=recipientReportPeriod(start,end); }
    catch (error) { return new Response(error instanceof Error ? error.message : "Período inválido.",{status:400,headers}); }
    const rows = await loadRecipientReport(client,search,period);
    const date = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    return new Response(recipientReportCsv(rows),{headers:{...headers,"Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="destinatarios-${start || end ? `${start || "inicio"}-a-${end || date}` : date}.csv"`,"X-Report-Row-Count":String(rows.length)}});
  } catch {
    return new Response("Não foi possível gerar o relatório completo. Tente novamente.",{status:500,headers});
  }
}
