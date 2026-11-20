import { formatBRL } from "@/lib/money";
import type { ImportItem } from "@/lib/catalog-import";
import type { Existing } from "@/lib/catalog-import-db";
import { discardImport, saveImport } from "./import-actions";

const KIND = { service: "Serviço", product: "Produto" } as const;
const SHOW = 300;

/** Draft of an imported spreadsheet: what will be created or changed, the skipped lines, and Save / Delete. */
export function ImportPreview({
  draft,
  match,
}: {
  draft: { id: string; kind: string; file_name: string; items: ImportItem[]; errors: string[]; total: number };
  match: (i: ImportItem) => Existing | undefined;
}) {
  const rows = draft.items.map((i) => ({ i, old: match(i) }));
  const created = rows.filter((r) => !r.old).length;
  const changed = rows.filter((r) => r.old && ((r.i.price_cents !== null && r.i.price_cents !== r.old.price_cents) || r.i.name !== r.old.name || (r.i.unit !== null && r.i.unit !== r.old.unit) || !r.old.active)).length;
  const same = rows.length - created - changed;
  const noPrice = rows.filter((r) => !r.old && !r.i.price_cents).length;

  return (
    <section className="card" style={{ marginBottom: 16, borderColor: "var(--orange)" }}>
      <h2 style={{ marginTop: 0 }}>Conferir planilha {draft.file_name ? `“${draft.file_name}”` : ""}</h2>
      <p style={{ marginTop: 0 }}>
        {draft.total} linha(s) lidas: <strong>{created}</strong> novo(s), <strong>{changed}</strong> com alteração, {same} sem mudança
        {draft.errors.length ? (
          <>
            , <strong style={{ color: "var(--bad)" }}>{draft.errors.length} ignorada(s)</strong>
          </>
        ) : null}
        .{noPrice ? ` ${noPrice} item(ns) novo(s) entram sem preço.` : ""} Nada foi gravado ainda.
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <form action={saveImport}>
          <input type="hidden" name="id" value={draft.id} />
          <input type="hidden" name="kind" value={draft.kind} />
          <button className="btn btn-primary">Salvar planilha</button>
        </form>
        <form action={discardImport}>
          <input type="hidden" name="id" value={draft.id} />
          <input type="hidden" name="kind" value={draft.kind} />
          <button className="btn btn-secondary" style={{ color: "var(--bad)" }}>
            Deletar planilha
          </button>
        </form>
      </div>

      {draft.errors.length ? (
        <details open={draft.errors.length <= 10} style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", color: "var(--bad)" }}>Linhas ignoradas ({draft.errors.length})</summary>
          <ul style={{ margin: "6px 0 0", fontSize: 14 }}>
            {draft.errors.slice(0, 100).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div style={{ maxHeight: 420, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Situação</th>
              <th>Código</th>
              <th>Tipo</th>
              <th>Nome</th>
              <th>Unidade</th>
              <th className="num">Preço</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOW).map(({ i, old }, n) => {
              const priceChanged = old && i.price_cents !== null && i.price_cents !== old.price_cents;
              return (
                <tr key={n}>
                  <td style={{ whiteSpace: "nowrap" }}>{old ? <span className="muted">Atualiza</span> : <strong style={{ color: "var(--ok)" }}>Novo</strong>}</td>
                  <td>{i.code ?? "—"}</td>
                  <td>{KIND[i.kind]}</td>
                  <td>
                    {i.name}
                    {old && old.name !== i.name ? <div className="muted" style={{ fontSize: 12 }}>antes: {old.name}</div> : null}
                  </td>
                  <td>{i.unit ?? old?.unit ?? "un"}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {priceChanged && old ? <span className="muted" style={{ textDecoration: "line-through", marginRight: 6 }}>{formatBRL(old.price_cents)}</span> : null}
                    {i.price_cents !== null ? formatBRL(i.price_cents) : old ? formatBRL(old.price_cents) : <span style={{ color: "var(--bad)" }}>sem preço</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > SHOW ? <p className="muted">Mostrando {SHOW} de {rows.length}. Todos serão salvos.</p> : null}
    </section>
  );
}
