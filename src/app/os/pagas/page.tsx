import Link from "next/link";
import { Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { fmtDate, METHOD_LABEL } from "@/lib/format";

const METHODS = ["pix", "credit_card", "debit_card", "cash", "boleto", "transfer"] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Sp = { dia?: string; de?: string; ate?: string; forma?: string; q?: string };

/** OS that were concluded and fully paid: searched by payment date, period and payment method. */
export default async function PaidOrdersPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const day = ISO.test(sp.dia ?? "") ? sp.dia : undefined;
  const de = day ?? (ISO.test(sp.de ?? "") ? sp.de : undefined);
  const ate = day ?? (ISO.test(sp.ate ?? "") ? sp.ate : undefined);
  const forma = METHODS.includes(sp.forma as (typeof METHODS)[number]) ? sp.forma : undefined;
  const q = (sp.q ?? "").trim();

  const { data: orders } = await ctx.sb
    .from("service_orders")
    .select("id, number, os_date, total_cents, customers(name)")
    .eq("org_id", ctx.orgId)
    .eq("status", "paid")
    .order("number", { ascending: false })
    .limit(1000);
  const ids = (orders ?? []).map((o) => o.id as string);
  const { data: recs } = ids.length
    ? await ctx.sb.from("receivables").select("id, origin_id, amount_cents, grouped_into_id").eq("origin_type", "service_order").in("origin_id", ids).neq("status", "cancelled")
    : { data: [] as { id: string; origin_id: string; amount_cents: number; grouped_into_id: string | null }[] };
  // Each payment counts for the OS of its receivable. A grouped item was paid through its group: it takes
  // the group's payment date and method, with its own share of the amount.
  const share = new Map<string, { os: string; part: number }[]>(); // receivable that holds the money -> OS shares
  const groupIds = [...new Set((recs ?? []).map((r) => r.grouped_into_id as string | null).filter(Boolean))] as string[];
  const { data: groups } = groupIds.length ? await ctx.sb.from("receivables").select("id, amount_cents").in("id", groupIds) : { data: [] };
  const groupAmount = new Map((groups ?? []).map((g) => [g.id as string, Number(g.amount_cents)]));
  for (const r of recs ?? []) {
    const holder = (r.grouped_into_id as string | null) ?? (r.id as string);
    const part = r.grouped_into_id ? Number(r.amount_cents) / (groupAmount.get(r.grouped_into_id as string) || Number(r.amount_cents)) : 1;
    share.set(holder, [...(share.get(holder) ?? []), { os: r.origin_id as string, part }]);
  }
  const recIds = [...share.keys()];
  const settlements: { receivable_id: string; paid_on: string; method: string; amount_cents: number }[] = [];
  for (let i = 0; i < recIds.length; i += 300) {
    const { data } = await ctx.sb.from("settlements").select("receivable_id, paid_on, method, amount_cents").in("receivable_id", recIds.slice(i, i + 300)).is("reversed_at", null);
    settlements.push(...((data ?? []) as typeof settlements));
  }

  // Per OS: when it was paid (last payment), how (methods) and how much.
  const info = new Map<string, { paidOn: string; methods: Map<string, number>; total: number }>();
  for (const s of settlements) {
    for (const { os, part } of share.get(s.receivable_id) ?? []) {
      const i = info.get(os) ?? { paidOn: "", methods: new Map<string, number>(), total: 0 };
      const amount = Math.round(Number(s.amount_cents) * part);
      if (s.paid_on > i.paidOn) i.paidOn = s.paid_on;
      i.methods.set(s.method, (i.methods.get(s.method) ?? 0) + amount);
      i.total += amount;
      info.set(os, i);
    }
  }

  const rows = (orders ?? [])
    .map((o) => ({ ...o, customer: (o.customers as unknown as { name: string } | null)?.name ?? "—", pay: info.get(o.id as string) }))
    .filter((o) => {
      if (!o.pay) return !de && !ate && !forma;
      if (de && o.pay.paidOn < de) return false;
      if (ate && o.pay.paidOn > ate) return false;
      if (forma && !o.pay.methods.has(forma)) return false;
      if (q && !(String(o.number) === q || o.customer.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });

  const byMethod = new Map<string, number>();
  for (const r of rows) for (const [m, v] of r.pay?.methods ?? []) if (!forma || m === forma) byMethod.set(m, (byMethod.get(m) ?? 0) + v);
  const total = [...byMethod.values()].reduce((a, b) => a + b, 0);
  const today = todayInSaoPaulo();

  return (
    <Shell>
      <h1>Ordens de serviço pagas</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Toda OS em <strong>Concluída</strong> que fica totalmente paga entra aqui sozinha. Se um recebimento for estornado, ela volta para Concluída.
      </p>
      <form className="row" style={{ marginBottom: 12 }}>
        <input name="q" placeholder="Nº da OS ou cliente" defaultValue={q} style={{ width: 200 }} />
        <label className="muted">Pagas no dia</label>
        <input type="date" name="dia" defaultValue={day ?? ""} style={{ width: 150 }} />
        <label className="muted">ou de</label>
        <input type="date" name="de" defaultValue={day ? "" : (sp.de ?? "")} style={{ width: 150 }} />
        <label className="muted">até</label>
        <input type="date" name="ate" defaultValue={day ? "" : (sp.ate ?? "")} style={{ width: 150 }} />
        <select name="forma" defaultValue={forma ?? ""} aria-label="Forma de pagamento" style={{ width: 180 }}>
          <option value="">Todas as formas</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary">Pesquisar</button>
        <Link className="btn btn-secondary" href={`/os/pagas?dia=${today}`}>
          Hoje
        </Link>
        {q || de || ate || forma ? (
          <Link className="btn btn-secondary" href="/os/pagas">
            Limpar
          </Link>
        ) : null}
      </form>

      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div className="muted">OS pagas</div>
          <strong style={{ fontSize: 20 }}>{rows.length}</strong>
        </div>
        <div>
          <div className="muted">Recebido{forma ? ` em ${METHOD_LABEL[forma]}` : ""}</div>
          <strong style={{ fontSize: 20 }}>{formatBRL(total)}</strong>
        </div>
        {[...byMethod.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([m, v]) => (
            <div key={m}>
              <div className="muted">{METHOD_LABEL[m] ?? m}</div>
              <strong>{formatBRL(v)}</strong>
            </div>
          ))}
      </div>

      {rows.length === 0 ? (
        <div className="card empty">Nenhuma OS paga com esses filtros.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>OS</th>
              <th>Cliente</th>
              <th>Data da OS</th>
              <th>Paga em</th>
              <th>Forma de pagamento</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/os/${r.id}`}>{r.number}</Link>
                </td>
                <td>{r.customer}</td>
                <td>{fmtDate(r.os_date)}</td>
                <td>{r.pay?.paidOn ? fmtDate(r.pay.paidOn) : "—"}</td>
                <td>
                  {r.pay
                    ? [...r.pay.methods.entries()].map(([m, v]) => `${METHOD_LABEL[m] ?? m}${r.pay!.methods.size > 1 ? ` ${formatBRL(v)}` : ""}`).join(" + ")
                    : "—"}
                </td>
                <td className="num">{formatBRL(r.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
