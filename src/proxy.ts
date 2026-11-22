import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie on every page request.
export async function proxy(request: NextRequest) {
  // The path goes along so pages can apply the access rules of the screen (see lib/session.ts).
  const next = () => {
    const h = new Headers(request.headers);
    h.set("x-pathname", request.nextUrl.pathname);
    return NextResponse.next({ request: { headers: h } });
  };
  let response = next();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await sb.auth.getUser();
  return response;
}

export const config = {
  // Webhooks and cron are server-to-server: no session to refresh.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
