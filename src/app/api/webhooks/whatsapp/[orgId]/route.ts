import { NextResponse } from "next/server";
import { tokenMatchesHash } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { readInbound } from "@/lib/whatsapp";
import { canSend, sendWhatsApp } from "@/lib/whatsapp-send";
import { handleRobotMessage, loadRobotContext } from "@/lib/whatsapp-robot";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Meta checks the callback URL with a GET carrying hub.verify_token and expects hub.challenge back.
export async function GET(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const url = new URL(req.url);
  if (!UUID.test(orgId)) return new NextResponse("not found", { status: 404 });
  const { data: org } = await supabaseAdmin().from("orgs").select("wa_verify_token").eq("id", orgId).maybeSingle();
  if (url.searchParams.get("hub.mode") === "subscribe" && org?.wa_verify_token && url.searchParams.get("hub.verify_token") === org.wa_verify_token) {
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// Messages from the provider. The URL carries ?token=… (shown in Configurações → Robô de WhatsApp).
// Always 200 once handled (also for ignored/unauthorized), so providers do not retry; 500 only on our failure.
// The reply text comes back as { replies: [{ to, text }] } for providers/automations that send it back.
export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = supabaseAdmin();
  const { data: org } = await admin.from("orgs").select("id, wa_token_hash, wa_provider, wa_api_url, wa_instance, wa_api_token_encrypted, wa_client_token_encrypted").eq("id", orgId).maybeSingle();
  const token = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-scsync-token");
  if (!org?.wa_token_hash || !tokenMatchesHash(token, org.wa_token_hash)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { provider, messages } = readInbound(body);
  if (!messages.length) return NextResponse.json({ received: true, messages: 0 });

  const context = await loadRobotContext(admin, orgId);
  const replies: { to: string; text: string }[] = [];
  for (const m of messages) {
    let r;
    try {
      r = await handleRobotMessage(admin, orgId, provider, m, context);
    } catch (e) {
      console.error("whatsapp robot", e instanceof Error ? e.message : String(e));
      return NextResponse.json({ error: "processing_failed" }, { status: 500 });
    }
    if (!r.handled || !r.reply || !r.inboxId) continue;
    let sent: boolean | null = null;
    if (canSend(org)) {
      try {
        await sendWhatsApp(org, m.from, r.reply);
        sent = true;
      } catch (e) {
        sent = false;
        console.error("whatsapp reply failed", { orgId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await admin.from("whatsapp_inbox").update({ reply_sent: sent }).eq("id", r.inboxId);
    replies.push({ to: m.from, text: r.reply });
  }
  return NextResponse.json({ received: true, replies });
}
