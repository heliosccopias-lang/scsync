import { COLOR_OPTIONS, FINISHING_OPTIONS, splitFinishing } from "@/lib/grafica";

type Defaults = {
  print_format?: string | null;
  print_paper?: string | null;
  print_colors?: string | null;
  finishing?: string[] | null;
  art_approved?: boolean;
  art_approved_at?: string | null;
};

/** The print-shop job fields, shared by "Nova OS" and the OS edit form. */
export function PrintSpecFields({ d, prefix = "" }: { d: Defaults; prefix?: string }) {
  const { checked, other } = splitFinishing(d.finishing);
  const id = (k: string) => `${prefix}${k}`;
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", margin: "0 0 16px" }}>
      <legend style={{ fontWeight: 600, padding: "0 6px" }}>Trabalho gráfico</legend>
      <div className="grid2">
        <div className="field">
          <label htmlFor={id("print_format")}>Formato / tamanho</label>
          <input id={id("print_format")} name="print_format" placeholder="Ex.: 9x5 cm, A4, 10x15 cm" defaultValue={d.print_format ?? ""} />
        </div>
        <div className="field">
          <label htmlFor={id("print_paper")}>Tipo de papel</label>
          <input id={id("print_paper")} name="print_paper" placeholder="Ex.: Couchê 300g, Sulfite 75g" defaultValue={d.print_paper ?? ""} />
        </div>
        <div className="field">
          <label htmlFor={id("print_colors")}>Cores</label>
          <select id={id("print_colors")} name="print_colors" defaultValue={d.print_colors ?? ""}>
            <option value="">—</option>
            {COLOR_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {d.print_colors && !(COLOR_OPTIONS as readonly string[]).includes(d.print_colors) ? (
              <option value={d.print_colors}>{d.print_colors}</option>
            ) : null}
          </select>
        </div>
        <div className="field">
          <span style={{ display: "block", marginBottom: 6 }}>Acabamento</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
            {FINISHING_OPTIONS.map(([key, label]) => (
              <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                <input type="checkbox" name={`fin_${key}`} defaultChecked={checked.has(key)} style={{ width: "auto" }} /> {label}
              </label>
            ))}
          </div>
          <input name="fin_other" aria-label="Outro acabamento" placeholder="Outro (ex.: verniz, dobra, furo)" defaultValue={other} style={{ marginTop: 8 }} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" name="art_approved" defaultChecked={!!d.art_approved} style={{ width: "auto" }} /> Arte aprovada pelo cliente
        </label>
        <label htmlFor={id("art_approved_at")} className="muted">
          em
        </label>
        <input id={id("art_approved_at")} name="art_approved_at" type="date" defaultValue={d.art_approved_at ?? ""} style={{ width: "auto" }} />
        <span className="muted" style={{ fontSize: 13 }}>Sem data, vale a de hoje.</span>
      </div>
    </fieldset>
  );
}
