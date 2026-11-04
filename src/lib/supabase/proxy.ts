import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/esqueci-senha",
  "/redefinir-senha",
  "/acesso-negado",
  "/auth/callback",
  "/api/health",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
}

function redirectWithCookies(request: NextRequest, response: NextResponse, destination: string) {
  const url = request.nextUrl.clone();
  url.pathname = destination;
  url.search = "";
  const redirectResponse = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }
  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next({ request });
    return redirectWithCookies(request, NextResponse.next({ request }), "/login");
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        if (headers) {
          Object.entries(headers).forEach(([name, value]) => {
            supabaseResponse.headers.set(name, value);
          });
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const userId = !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const pathname = request.nextUrl.pathname;

  if (!userId) {
    return isPublicPath(pathname)
      ? supabaseResponse
      : redirectWithCookies(request, supabaseResponse, "/login");
  }

  if (pathname === "/auth/callback" || pathname === "/acesso-negado") {
    return supabaseResponse;
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile?.is_active) {
    return redirectWithCookies(request, supabaseResponse, "/acesso-negado");
  }

  if (pathname === "/login" || pathname === "/esqueci-senha") {
    return redirectWithCookies(request, supabaseResponse, "/");
  }

  return supabaseResponse;
}
