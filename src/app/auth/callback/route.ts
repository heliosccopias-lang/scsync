import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseUser } from "@/lib/supabase";

/**
 * Where the confirmation e-mail sends the person. Works in any browser: if the link was opened somewhere else
 * (no PKCE verifier there), the e-mail is still confirmed by Supabase and the person just signs in with the password.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const sb = await supabaseUser();

  if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return to(type === "recovery" ? "/minha-senha" : "/");
  } else if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return to("/");
  }
  if (url.searchParams.get("error_code") === "otp_expired") {
    return to(`/login?error=${encodeURIComponent("O link do e-mail expirou. Entre com e-mail e senha; se pedir confirmação, use \"Reenviar e-mail de confirmação\".")}`);
  }
  return to(`/login?ok=${encodeURIComponent("E-mail confirmado. Agora entre com seu e-mail e senha.")}`);
}
