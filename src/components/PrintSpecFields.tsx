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
    <fieldset className="print-spec">
      <legend>Trabalho gráfico</legend>
      <div className="print-spec-row">
        <div className="field ps-format">
          <label htmlFor={id("print_format")}>Formato / tamanho</label>
          <input id={id("print_format")} name="print_format" placeholder="9x5 cm, A4…" defaultValue={d.print_format ?? ""} />
        </div>
        <div className="field ps-paper">
          <label htmlFor={id("print_paper")}>Tipo de papel</label>
          <input id={id("print_paper")} name="print_paper" placeholder="Couchê 300g…" defaultValue={d.print_paper ?? ""} />
        </div>
        <div className="field ps-colors">
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
        <div className="field ps-finish">
          <span className="ps-label">Acabamento</span>
          <div className="ps-chips">
            {FINISHING_OPTIONS.map(([key, label]) => (
              <label key={key} className="ps-chip">
                <input type="checkbox" name={`fin_${key}`} defaultChecked={checked.has(key)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="field ps-other">
          <label htmlFor={id("fin_other")}>Outros</label>
          <input id={id("fin_other")} name="fin_other" placeholder="Verniz, dobra, furo…" defaultValue={other} />
        </div>
      </div>
      <div className="print-spec-art">
        <label className="ps-chip">
          <input type="checkbox" name="art_approved" defaultChecked={!!d.art_approved} />
          Arte aprovada pelo cliente
        </label>
        <label htmlFor={id("art_approved_at")} className="muted">
          em
        </label>
        <input id={id("art_approved_at")} name="art_approved_at" type="date" defaultValue={d.art_approved_at ?? ""} />
        <span className="muted">Sem data, vale a de hoje.</span>
      </div>
    </fieldset>
  );
}
