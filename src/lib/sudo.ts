import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

/** Owner re-authentication: sensitive settings ask for the password again; valid for 15 minutes. */
const COOKIE = "scsync_sudo";
const TTL = 15 * 60;

function sign(payload: string): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("APP_ENCRYPTION_KEY is not set");
  return createHmac("sha256", `sudo:${key}`).update(payload).digest("base64url");
}

export async function hasSudo(userId: string): Promise<boolean> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return false;
  const [uid, exp, sig] = v.split(".");
  if (uid !== userId || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(`${uid}.${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Checks the password with a throwaway client (does not touch the current session). */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return !error;
}

export async function grantSudo(userId: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  (await cookies()).set(COOKIE, `${userId}.${exp}.${sign(`${userId}.${exp}`)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL,
  });
}
