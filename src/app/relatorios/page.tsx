import { Shell } from "@/components/Shell";
import { addMonths, todayInSaoPaulo } from "@/lib/money";
import { runReports } from "@/lib/reports";
import { requireOrg } from "@/lib/session";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const sp = await searchParams;
  const today = todayInSaoPaulo();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = sp.ate && iso.test(sp.ate) ? sp.ate : today;
  const from = sp.de && iso.test(sp.de) ? sp.de : `${addMonths(today, -2).slice(0, 8)}01`;
  const { sb, orgId, orgName } = await requireOrg();
  const tables = await runReports(sb, orgId, from, to);

  return (
    <Shell orgName={orgName}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Relatórios</h1>
        <form className="row">
          <label className="muted" style={{ margin: 0 }}>
            De
          </label>
          <input type="date" name="de" defaultValue={from} style={{ width: 160 }} />
          <label className="muted" style={{ margin: 0 }}>
            até
          </label>
          <input type="date" name="ate" defaultValue={to} style={{ width: 160 }} />
          <button className="btn btn-secondary">Atualizar</button>
        </form>
      </div>
      {tables.map((t) => (
        <section key={t.key} style={{ marginTop: 24 }}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{t.title}</h2>
            <a className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 13 }} href={`/relatorios/csv?r=${t.key}&de=${from}&ate=${to}`}>
              Exportar CSV
            </a>
          </div>
          {t.note ? <p className="muted" style={{ margin: "0 0 6px", fontSize: 13 }}>{t.note}</p> : null}
          {t.rows.length === 0 ? (
            <div className="card empty" style={{ padding: 16 }}>
              Sem dados no período.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  {t.columns.map((c, i) => (
                    <th key={c} className={t.numeric[i] ? "num" : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j} className={t.numeric[j] ? "num" : undefined}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </Shell>
  );
}
