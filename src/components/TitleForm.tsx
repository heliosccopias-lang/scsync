import { createTitle } from "@/app/receber/actions";
import { METHOD_LABEL } from "@/lib/format";
import { todayInSaoPaulo } from "@/lib/money";

/** "Nova conta" form shared by contas a receber and contas a pagar. */
export function TitleForm({
  kind,
  customers,
  categories,
  costCenters,
  accounts,
}: {
  kind: "receivable" | "payable";
  customers?: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  costCenters: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
}) {
  const receivable = kind === "receivable";
  return (
    <details className="card" style={{ marginBottom: 16 }}>
      <summary className="btn btn-primary" style={{ display: "inline-flex" }}>
        {receivable ? "Nova conta a receber" : "Nova conta a pagar"}
      </summary>
      <form action={createTitle} style={{ marginTop: 12 }}>
        <input type="hidden" name="kind" value={kind} />
        <div className="grid2">
          <div className="field">
            <label htmlFor="t_name">Descrição</label>
            <input id="t_name" name="name" placeholder={receivable ? "Ex.: Contrato de manutenção" : "Ex.: Aluguel"} required />
          </div>
          {receivable ? (
            <div className="field">
              <label htmlFor="t_customer">Cliente</label>
              <select id="t_customer" name="customer_id" defaultValue="">
                <option value="">— Sem cliente —</option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="t_supplier">Fornecedor</label>
              <input id="t_supplier" name="supplier" />
            </div>
          )}
          <div className="field">
            <label htmlFor="t_amount">Valor total (R$)</label>
            <input id="t_amount" name="amount" inputMode="decimal" placeholder="150,00" required />
          </div>
          <div className="field">
            <label htmlFor="t_due">1º vencimento</label>
            <input id="t_due" name="due_date" type="date" defaultValue={todayInSaoPaulo()} />
          </div>
          <div className="field">
            <label htmlFor="t_inst">Parcelas (mensais)</label>
            <input id="t_inst" name="installments" type="number" min={1} max={48} defaultValue={1} />
          </div>
          <div className="field">
            <label htmlFor="t_method">Forma</label>
            <select id="t_method" name="method" defaultValue={receivable ? "pix" : "transfer"}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t_cat">Categoria</label>
            <select id="t_cat" name="category_id" defaultValue="">
              <option value="">— Sem categoria —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t_cc">Centro de custo</label>
            <select id="t_cc" name="cost_center_id" defaultValue="">
              <option value="">— Nenhum —</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t_bank">Conta</label>
            <select id="t_bank" name="bank_account_id">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="t_notes">Observações</label>
          <input id="t_notes" name="notes" />
        </div>
        <button className="btn btn-primary">Lançar</button>
      </form>
    </details>
  );
}
