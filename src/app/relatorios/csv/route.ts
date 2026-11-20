import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { runReports } from "@/lib/reports";
import { supabaseUser } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sb = await supabaseUser();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: m } = await sb.from("org_members").select("org_id").eq("user_id", auth.user.id).order("created_at").limit(1).maybeSingle();
  if (!m) return NextResponse.json({ error: "no_org" }, { status: 403 });
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = url.searchParams.get("de") ?? "";
  const to = url.searchParams.get("ate") ?? "";
  if (!iso.test(from) || !iso.test(to)) return NextResponse.json({ error: "bad_period" }, { status: 400 });
  const tables = await runReports(sb, m.org_id, from, to);
  const t = tables.find((x) => x.key === url.searchParams.get("r"));
  if (!t) return NextResponse.json({ error: "unknown_report" }, { status: 404 });
  return new NextResponse(toCsv(t), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${t.key}-${from}-a-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
