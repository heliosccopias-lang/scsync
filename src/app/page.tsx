import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseUser } from "@/lib/supabase";
import { requireOrg } from "@/lib/session";
import { homeFor } from "@/lib/access";
import { TRIAL_DAYS } from "@/lib/plans";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "SCsync — gestão para gráficas rápidas",
  description: `Ordem de serviço, cobrança por Pix e boleto, conciliação bancária e de cartão para gráficas. Teste grátis por ${TRIAL_DAYS} dias.`,
};

export default async function Home() {
  const sb = await supabaseUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) return <Landing />;
  const ctx = await requireOrg();
  redirect(homeFor(ctx));
}
