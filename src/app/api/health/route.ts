import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabasePublicConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  const omieCredentialsPresent = Boolean(
    process.env.OMIE_APP_KEY &&
    process.env.OMIE_APP_SECRET &&
    process.env.OMIE_APP_HASH
  );

  return NextResponse.json({
    status: "ok",
    application: "uber-fulfillment-fullbrands",
    timestamp: new Date().toISOString(),
    integrations: {
      supabasePublicClientConfigured: supabasePublicConfigured,
      supabaseAuthenticationConfigured: false,
      omieCredentialsPresent,
    },
    mode: "preview",
  });
}
