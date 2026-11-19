import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Checks that the server's Supabase keys reach the right database. Reveals no data.
export async function GET() {
  const checks: Record<string, boolean> = {
    supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabase_public_key: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabase_secret_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    encryption_key: Boolean(process.env.APP_ENCRYPTION_KEY),
    app_url: Boolean(process.env.APP_URL),
  };
  let database = false;
  try {
    const { error } = await supabaseAdmin().from("webhook_events").select("id", { head: true, count: "exact" }).limit(1);
    database = !error;
  } catch {
    database = false;
  }
  const ok = database && Object.values(checks).every(Boolean);
  return NextResponse.json({ ok, database, ...checks }, { status: ok ? 200 : 503 });
}
