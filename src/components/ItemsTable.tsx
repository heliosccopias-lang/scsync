"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseQuantity } from "@/lib/money";

export type ItemRow = { kind: string; desc: string; qty: string; price: string };

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Price in Brazilian format: 1.250,00 or 150 or 150,5. */
const priceOf = (s: string) => {
  const n = Number(s.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
/** Quantity exactly as the server reads it (1.000 = mil, 2,5 = dois e meio, empty = 1). */
const qtyOf = (s: string) => parseQuantity(s) ?? 0;

/**
 * Items of an OS as a table (type, description, quantity, unit price, line total) with subtotal,
 * discount and grand total worked out as the person types. Field names are the ones the server actions read.
 */
export function ItemsTable({
  rows,
  initial,
  bad,
  discountDefault,
  discountId = "discount",
  firstPlaceholder = "Digite ou escolha do catálogo",
}: {
  rows: number;
  initial: (i: number) => ItemRow;
  bad: (name: string) => object;
  discountDefault: string;
  discountId?: string;
  firstPlaceholder?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<number[]>(() => Array(rows).fill(0));
  const [discount, setDiscount] = useState(0);

  const recalc = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const get = (n: string) => (el.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value ?? "";
    const next: number[] = [];
    for (let i = 0; i < rows; i++) {
      const desc = get(`item_desc_${i}`).trim();
      const price = get(`item_price_${i}`);
      next.push(desc && price.trim() ? Math.round(qtyOf(get(`item_qty_${i}`)) * priceOf(price) * 100) : 0);
    }
    setLines(next);
    setDiscount(Math.round(priceOf(get("discount")) * 100));
  }, [rows]);

  // Totals for what is already filled in (editing an OS, or values kept after an error).
  useEffect(() => {
    recalc();
  }, [recalc]);

  const subtotal = lines.reduce((a, b) => a + b, 0);
  const total = Math.max(0, subtotal - discount);

  return (
    // The catalog fill (on the form) runs after this handler: recalculate on the next tick to see its price.
    <div ref={box} onInput={() => setTimeout(recalc, 0)} onChange={() => setTimeout(recalc, 0)}>
      <div style={{ overflowX: "auto" }}>
        <table className="items-table">
          <colgroup>
            <col style={{ width: 118 }} />
            <col />
            <col style={{ width: 96 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Descrição do serviço</th>
              <th className="num">Quantidade</th>
              <th className="num">Preço unitário (R$)</th>
              <th className="num">Valor total</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => {
              const it = initial(i);
              return (
                <tr key={i}>
                  <td>
                    <select name={`item_kind_${i}`} aria-label={`Tipo do item ${i + 1}`} defaultValue={it.kind}>
                      <option value="service">Serviço</option>
                      <option value="product">Produto</option>
                    </select>
                  </td>
                  <td>
                    <input
                      name={`item_desc_${i}`}
                      list="catalog-items"
                      autoComplete="off"
                      placeholder={i === 0 ? firstPlaceholder : ""}
                      aria-label={`Descrição do item ${i + 1}`}
                      defaultValue={it.desc}
                      {...bad(`item_desc_${i}`)}
                    />
                  </td>
                  <td>
                    <input
                      name={`item_qty_${i}`}
                      inputMode="decimal"
                      aria-label={`Quantidade do item ${i + 1}`}
                      defaultValue={it.qty}
                      className="num-input"
                      {...bad(`item_qty_${i}`)}
                    />
                  </td>
                  <td>
                    <input
                      name={`item_price_${i}`}
                      inputMode="decimal"
                      placeholder="150,00"
                      aria-label={`Preço unitário do item ${i + 1}`}
                      defaultValue={it.price}
                      className="num-input"
                      {...bad(`item_price_${i}`)}
                    />
                  </td>
                  <td className="num" style={{ whiteSpace: "nowrap", fontWeight: lines[i] ? 600 : 400 }}>
                    {lines[i] ? brl(lines[i]) : <span className="muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="items-totals">
        <div>
          <span>Subtotal</span>
          <strong>{brl(subtotal)}</strong>
        </div>
        <div>
          <label htmlFor={discountId}>Desconto (R$)</label>
          <input id={discountId} name="discount" inputMode="decimal" placeholder="0,00" defaultValue={discountDefault} className="num-input" {...bad("discount")} />
        </div>
        <div className="items-grand">
          <span>Total geral</span>
          <strong>{brl(total)}</strong>
        </div>
      </div>
    </div>
  );
}
