import Link from "next/link";
import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { formatBRL, todayInSaoPaulo } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { addExpense, importStatementFile, pullStatementPluggy, updateExpense } from "./actions";

/** Next closing/due dates from the card's days, for the defaults of the forms. */
function nextDates(today: string, closingDay: number | null, dueDay: number | null) {
  if (!closingDay) return { closing: "", due: "" };
  const [y, m, d] = today.split("-").map(Number);
  const mk = (yy: number, mm: number, dd: number) => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(dd, last)).padStart(2, "0")}`;
  };
  // The bill being reconciled is usually the one that closed most recently.
  let cy = y;
  let cm = m;
  if (d < closingDay) {
    cm -= 1;
    if (cm === 0) {
      cm = 12;
      cy -= 1;
    }
  }
  const closing = mk(cy, cm, closingDay);
  let due = "";
  if (dueDay) {
    let dy = cy;
    let dm = dueDay > closingDay ? cm : cm + 1;
    if (dm === 13) {
      dm = 1;
      dy += 1;
    }
    due = mk(dy, dm, dueDay);
  }
  return { closing, due };
}

const SOURCE: Record<string, string> = { file: "Arquivo", api: "Pluggy", manual: "Manual" };

export default async function CardsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; cartao?: string }> }) {
  const { error, ok, cartao } = await searchParams;
  const { sb, orgId, orgName } = await requireOrg();
  const today = todayInSaoPaulo();
  const [{ data: cards }, { data: statements }, { data: expenses }, { data: cats }] = await Promise.all([
    sb.from("credit_cards").select("id, name, last4, closing_day, due_day, pluggy_account_id").eq("org_id", orgId).eq("active", true).order("name"),
    sb.from("card_statements").select("id, card_id, reference, closing_date, due_date, source, status, payable_id").eq("org_id", orgId).order("closing_date", { ascending: false }).limit(36),
    sb.from("card_expenses").select("id, card_id, category_id, spent_on, amount_cents, description, source, sender_name").eq("org_id", orgId).eq("status", "pending").order("spent_on", { ascending: false }).limit(200),
    sb.from("financial_categories").select("id, name").eq("org_id", orgId).eq("direction", "out").order("name"),
  ]);
  const stIds = (statements ?? []).map((s) => s.id);
  const { data: lines } = stIds.length
    ? await sb.from("card_transactions").select("statement_id, status, amount_cents").in("statement_id", stIds)
    : { data: [] as { statement_id: string; status: string; amount_cents: number }[] };
  const summary = new Map<string, { total: number; pending: number; count: number }>();
  for (const l of lines ?? []) {
    const s = summary.get(l.statement_id) ?? { total: 0, pending: 0, count: 0 };
    if (l.status !== "ignored") s.total += Number(l.amount_cents);
    if (l.status === "pending") s.pending++;
    s.count++;
    summary.set(l.statement_id, s);
  }
  const cardName = new Map((cards ?? []).map((c) => [c.id, c.name]));
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const selected = (cards ?? []).find((c) => c.id === cartao) ?? (cards ?? [])[0];
  const dates = selected ? nextDates(today, selected.closing_day, selected.due_day) : { closing: "", due: "" };

  if (!(cards ?? []).length) {
    return (
      <Shell orgName={orgName}>
        <h1>Conciliação de cartão de crédito</h1>
        <Notice error={error} ok={ok} />
        <div className="card empty">
          Cadastre primeiro o cartão em <Link href="/configuracoes/cartoes">Configurações → Cartões de crédito</Link>. Para lançar despesas pelo WhatsApp, configure
          também o <Link href="/configuracoes/whatsapp">Robô de WhatsApp</Link>. Para testar sem nada configurado, use o{" "}
          <Link href="/cartoes/simulador">simulador do robô</Link>.
        </div>
      </Shell>
    );
  }

  const periodInputs = (
    <>
      <select name="card_id" defaultValue={selected?.id} aria-label="Cartão" style={{ width: 200 }}>
        {(cards ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.last4 ? ` •••• ${c.last4}` : ""}
          </option>
        ))}
      </select>
      <label className="muted" style={{ margin: 0 }}>
        Fechamento
      </label>
      <input type="date" name="closing_date" defaultValue={dates.closing} required style={{ width: 150 }} />
      <label className="muted" style={{ margin: 0 }}>
        Vencimento
      </label>
      <input type="date" name="due_date" defaultValue={dates.due} required style={{ width: 150 }} />
    </>
  );

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Conciliação de cartão de crédito</h1>
        <span className="muted">
          <Link href="/configuracoes/cartoes">Cartões</Link> · <Link href="/configuracoes/conexoes">Conexões (API e automático)</Link> ·{" "}
          <Link href="/configuracoes/whatsapp">Robô de WhatsApp</Link> · <Link href="/cartoes/simulador">Testar o robô (simulador)</Link>
        </span>
      </div>
      <Notice error={error} ok={ok} />

      <div className="grid2" style={{ marginBottom: 16 }}>
        <form action={importStatementFile} className="card">
          <h2 style={{ marginTop: 0 }}>Importar fatura (arquivo)</h2>
          <div className="row" style={{ marginBottom: 10 }}>{periodInputs}</div>
          <div className="row">
            <input type="file" name="file" accept=".ofx,.csv,.txt" required style={{ width: "auto" }} />
            <button className="btn btn-primary">Importar</button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            OFX ou CSV exportado do internet banking (Itaú, Bradesco, Santander e outros). Importar o mesmo arquivo de novo não duplica.
          </p>
        </form>
        <form action={pullStatementPluggy} className="card">
          <h2 style={{ marginTop: 0 }}>Puxar fatura pela API (Pluggy)</h2>
          <div className="row" style={{ marginBottom: 10 }}>{periodInputs}</div>
          <button className="btn btn-primary" disabled={!(cards ?? []).some((c) => c.pluggy_account_id)}>
            Puxar lançamentos
          </button>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {(cards ?? []).some((c) => c.pluggy_account_id)
              ? "Traz as compras do mês até o fechamento, direto do banco. Para importar sozinho todo dia, ligue o automático em Conexões."
              : "Nenhum cartão ligado ao Pluggy ainda (Configurações → Cartões de crédito)."}
          </p>
        </form>
      </div>

      <h2>Faturas</h2>
      {(statements ?? []).length === 0 ? (
        <div className="card empty" style={{ marginBottom: 16 }}>
          Nenhuma fatura importada ainda.
        </div>
      ) : (
        <table style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Cartão</th>
              <th>Fatura</th>
              <th>Vencimento</th>
              <th>Origem</th>
              <th>Situação</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {(statements ?? []).map((s) => {
              const sm = summary.get(s.id) ?? { total: 0, pending: 0, count: 0 };
              return (
                <tr key={s.id}>
                  <td>{cardName.get(s.card_id) ?? "—"}</td>
                  <td>
                    <Link href={`/cartoes/${s.id}`}>{s.reference.split("-").reverse().join("/")}</Link>
                  </td>
                  <td>{fmtDate(s.due_date)}</td>
                  <td>{SOURCE[s.source] ?? s.source}</td>
                  <td>
                    {s.status === "closed" ? (
                      <span className="pill pill-paid">Fechada</span>
                    ) : sm.pending ? (
                      <span className="pill pill-partial">{sm.pending} a conciliar</span>
                    ) : (
                      <span className="pill pill-open">Pronta para fechar</span>
                    )}
                  </td>
                  <td className="num">{formatBRL(sm.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Despesas lançadas aguardando a fatura ({(expenses ?? []).length})</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Despesas mandadas pelo WhatsApp ou lançadas aqui. Elas são casadas com os lançamentos da fatura quando ela é importada.
      </p>
      {(expenses ?? []).length ? (
        <table style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Despesa</th>
              <th>Por</th>
              <th>Cartão / categoria</th>
              <th className="num">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(expenses ?? []).map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.spent_on)}</td>
                <td>{e.description}</td>
                <td className="muted">{e.source === "whatsapp" ? `WhatsApp${e.sender_name ? ` · ${e.sender_name}` : ""}` : "Manual"}</td>
                <td>
                  <form action={updateExpense} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                    <input type="hidden" name="id" value={e.id} />
                    <select name="card_id" defaultValue={e.card_id ?? ""} aria-label="Cartão" style={{ width: 130 }}>
                      <option value="">Cartão?</option>
                      {(cards ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select name="category_id" defaultValue={e.category_id ?? ""} aria-label="Categoria" style={{ width: 150 }}>
                      <option value="">Categoria?</option>
                      {(cats ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-secondary">Salvar</button>
                  </form>
                </td>
                <td className="num">{formatBRL(e.amount_cents)}</td>
                <td>
                  <form action={updateExpense}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="cancel" value="true" />
                    <button className="btn btn-secondary" title={catName.get(e.category_id ?? "") ?? ""}>
                      Cancelar
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="card empty" style={{ marginBottom: 12 }}>
          Nenhuma despesa aguardando.
        </div>
      )}

      <form action={addExpense} className="card row">
        <strong>Lançar despesa</strong>
        <input name="spent_on" type="date" defaultValue={today} aria-label="Data" style={{ width: 150 }} />
        <input name="description" placeholder="Descrição" style={{ width: 220 }} required />
        <input name="amount" placeholder="Valor" inputMode="decimal" style={{ width: 110 }} required />
        <select name="card_id" defaultValue={selected?.id ?? ""} aria-label="Cartão" style={{ width: 150 }}>
          {(cards ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="category_id" defaultValue="" aria-label="Categoria" style={{ width: 160 }}>
          <option value="">Categoria</option>
          {(cats ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary">Lançar</button>
      </form>
    </Shell>
  );
}
