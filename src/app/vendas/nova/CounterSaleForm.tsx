"use client";

import { useActionState, useState, type FormEvent } from "react";
import { createSale, type SaleState } from "./actions";
import { SALE_LINES } from "./constants";
import type { CatalogEntry } from "@/app/os/nova/NewOrderForm";
import { parseQuantity } from "@/lib/money";

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (s: string) => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

export function CounterSaleForm({
  catalog,
  customers,
  canReceive,
  attendants,
  defaultAttendant,
  canManageAttendants,
  conditions = [],
}: {
  catalog: CatalogEntry[];
  customers: { id: string; name: string }[];
  canReceive: boolean;
  attendants: { id: string; name: string }[];
  defaultAttendant: string;
  canManageAttendants: boolean;
  conditions?: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<SaleState, FormData>(createSale, {});
  const v = state.values ?? {};
  const [total, setTotal] = useState(0);
  const [lineTotals, setLineTotals] = useState<number[]>(() => Array(SALE_LINES).fill(0));
  const [method, setMethod] = useState(v.method ?? (canReceive ? "cash" : "later"));
  const [condition, setCondition] = useState(v.condition_id ?? "");
  const bad = (name: string) => (state.field === name ? { "aria-invalid": true, style: { borderColor: "var(--bad)" } } : {});

  function onInput(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const t = e.target as HTMLInputElement;
    const m = /^item_desc_(\d+)$/.exec(t.name ?? "");
    if (m) {
      const hit = catalog.find((c) => c.name.toLowerCase() === t.value.trim().toLowerCase());
      const price = form.elements.namedItem(`item_price_${m[1]}`) as HTMLInputElement | null;
      const qty = form.elements.namedItem(`item_qty_${m[1]}`) as HTMLInputElement | null;
      if (hit && price && !price.value) price.value = (hit.price_cents / 100).toFixed(2).replace(".", ",");
      if (hit && qty && !qty.value) qty.value = "1";
    }
    let sum = 0;
    const lines: number[] = [];
    for (let i = 0; i < SALE_LINES; i++) {
      const q = (form.elements.namedItem(`item_qty_${i}`) as HTMLInputElement | null)?.value ?? "";
      const p = (form.elements.namedItem(`item_price_${i}`) as HTMLInputElement | null)?.value ?? "";
      // Quantity like the server reads it (2,5 or 2.5); price in Brazilian format (1.250,00).
      const qty = parseQuantity(q) ?? 0;
      const line = p ? Math.round(qty * num(p) * 100) : 0;
      lines.push(line);
      sum += line;
    }
    setLineTotals(lines);
    const d = (form.elements.namedItem("discount") as HTMLInputElement | null)?.value ?? "";
    setTotal(Math.max(0, sum - Math.round(num(d) * 100)));
  }

  return (
    <form action={action} key={JSON.stringify(v)} noValidate onInput={onInput}>
      <datalist id="sale-items">
        {catalog.map((c) => (
          <option key={c.id} value={c.name}>
            {(c.price_cents / 100).toFixed(2).replace(".", ",")}
          </option>
        ))}
      </datalist>
      {state.error ? (
        <div className="notice notice-error" role="alert">
          {state.error}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 240, maxWidth: 420 }}>
            <label htmlFor="customer_id">Cliente (opcional)</label>
            <select id="customer_id" name="customer_id" defaultValue={v.customer_id ?? ""}>
              <option value="">Consumidor final</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field attendant-field" style={{ flex: 1, minWidth: 240, maxWidth: 360 }}>
            <label htmlFor="technician_id">
              <span className="attendant-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.3-8 5.2V21h16v-1.8c0-2.9-3.6-5.2-8-5.2Z" />
                </svg>
              </span>
              Atendente / técnico
            </label>
            <select id="technician_id" name="technician_id" defaultValue={v.technician_id ?? defaultAttendant} {...bad("technician_id")}>
              <option value="">— Não informado —</option>
              {attendants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {!attendants.length ? (
              <span className="muted" style={{ fontSize: 12 }}>
                {canManageAttendants ? (
                  <>
                    Cadastre a equipe em <a href="/cadastros/tecnicos">Cadastros → Técnicos</a>.
                  </>
                ) : (
                  "Peça ao administrador para cadastrar a equipe em Cadastros → Técnicos."
                )}
              </span>
            ) : null}
          </div>
        </div>
        <table className="sale-table">
          <colgroup>
            <col />
            <col style={{ width: 90 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Descrição do produto</th>
              <th className="num">Quantidade</th>
              <th className="num">Preço unitário (R$)</th>
              <th className="num">Valor total</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SALE_LINES }, (_, i) => (
              <tr key={i}>
                <td>
                  <input
                    name={`item_desc_${i}`}
                    list="sale-items"
                    autoComplete="off"
                    placeholder={i === 0 ? "Digite ou escolha o produto" : ""}
                    aria-label={`Descrição do produto ${i + 1}`}
                    style={{ width: "100%" }}
                    defaultValue={v[`item_desc_${i}`]}
                    {...bad(`item_desc_${i}`)}
                  />
                </td>
                <td>
                  <input name={`item_qty_${i}`} inputMode="decimal" aria-label={`Quantidade ${i + 1}`} defaultValue={v[`item_qty_${i}`]} style={{ textAlign: "right" }} {...bad(`item_qty_${i}`)} />
                </td>
                <td>
                  <input name={`item_price_${i}`} inputMode="decimal" aria-label={`Preço unitário ${i + 1}`} defaultValue={v[`item_price_${i}`]} style={{ textAlign: "right" }} {...bad(`item_price_${i}`)} />
                </td>
                <td className="num" style={{ whiteSpace: "nowrap", fontWeight: lineTotals[i] ? 600 : 400 }}>
                  {lineTotals[i] ? brl(lineTotals[i]) : <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
          <div className="field" style={{ width: 160, marginBottom: 0 }}>
            <label htmlFor="discount">Desconto (R$)</label>
            <input id="discount" name="discount" inputMode="decimal" defaultValue={v.discount} {...bad("discount")} />
          </div>
          <div style={{ marginLeft: "auto", fontSize: 22 }}>
            Total: <strong>{brl(total)}</strong>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <strong>Condição de pagamento</strong>
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="method">Forma</label>
            <select id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)} {...bad("method")}>
              {canReceive ? (
                <optgroup label="À vista: recebido agora">
                  <option value="cash">Dinheiro</option>
                  <option value="pix">Pix direto na conta</option>
                  <option value="debit_card">Cartão de débito (maquininha)</option>
                  <option value="credit_card">Cartão de crédito (maquininha, à vista ou parcelado)</option>
                  <option value="transfer">Transferência / TED</option>
                </optgroup>
              ) : null}
              <optgroup label="Cobrar em seguida">
                <option value="later">Pix Asaas, boleto ou maquininha integrada</option>
              </optgroup>
              <optgroup label="A prazo (cliente cadastrado)">
                <option value="term">Parcelado / condição de pagamento (30/60/90…)</option>
              </optgroup>
            </select>
          </div>
          {method === "credit_card" ? (
            <div className="field">
              <label htmlFor="card_installments">Parcelas no crédito</label>
              <input id="card_installments" name="card_installments" type="number" min={1} max={24} defaultValue={v.card_installments ?? 1} />
            </div>
          ) : null}
          {method === "debit_card" || method === "credit_card" || method === "transfer" ? (
            <div className="field">
              <label htmlFor="reference">{method === "transfer" ? "Identificação da transferência (opcional)" : "Código de autorização / NSU (opcional)"}</label>
              <input id="reference" name="reference" defaultValue={v.reference} />
            </div>
          ) : null}
          {method === "later" ? (
            <div className="field">
              <label htmlFor="later_method">Como vai cobrar</label>
              <select id="later_method" name="later_method" defaultValue={v.later_method ?? "pix"}>
                <option value="pix">Pix (Asaas, QR Code na tela)</option>
                <option value="boleto">Boleto (Asaas)</option>
                <option value="debit_card">Maquininha integrada (débito)</option>
                <option value="credit_card">Maquininha integrada (crédito)</option>
              </select>
            </div>
          ) : null}
        </div>
        {method === "term" ? (
          <div className="grid2">
            {conditions.length ? (
              <div className="field">
                <label htmlFor="condition_id">Condição cadastrada</label>
                <select id="condition_id" name="condition_id" value={condition} onChange={(e) => setCondition(e.target.value)} {...bad("condition_id")}>
                  <option value="">Nenhuma: definir parcelas abaixo</option>
                  {conditions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="term_method">Cobrar cada parcela por</label>
              <select key={condition ? "cond" : "manual"} id="term_method" name="term_method" defaultValue={v.term_method ?? (condition ? "" : "boleto")}>
                {condition ? <option value="">Forma padrão da condição</option> : null}
                <option value="boleto">Boleto</option>
                <option value="pix">Pix</option>
                <option value="credit_card">Cartão de crédito</option>
                <option value="transfer">Transferência</option>
                <option value="cash">Dinheiro (carnê / crediário)</option>
              </select>
            </div>
            {!condition ? (
              <>
                <div className="field">
                  <label htmlFor="term_count">Número de parcelas</label>
                  <input id="term_count" name="term_count" type="number" min={1} max={48} defaultValue={v.term_count ?? 1} {...bad("term_count")} />
                </div>
                <div className="field">
                  <label htmlFor="term_first_due">1º vencimento</label>
                  <input id="term_first_due" name="term_first_due" type="date" defaultValue={v.term_first_due ?? ""} {...bad("term_first_due")} />
                </div>
              </>
            ) : null}
            <p className="muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
              Venda a prazo precisa de um cliente cadastrado (não vale &quot;Consumidor final&quot;). As parcelas entram em Contas a receber.
            </p>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="notes">Observação (opcional)</label>
          <input id="notes" name="notes" defaultValue={v.notes} />
        </div>
        <button className="btn btn-primary" disabled={pending} style={{ fontSize: 16, padding: "10px 18px" }}>
          {pending ? "Registrando…" : method === "later" ? "Registrar venda e cobrar" : method === "term" ? "Registrar venda a prazo" : "Finalizar venda"}
        </button>
      </div>
    </form>
  );
}
