"use client";

import { useActionState } from "react";
import { updateItems, type EditItemsState } from "./items-action";

type Item = { kind: string; description: string; quantity: number | string; unit_price_cents: number };

const EXTRA_ROWS = 3;

function money(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function EditItemsForm({ osId, items, discountCents }: { osId: string; items: Item[]; discountCents: number }) {
  const [state, action, pending] = useActionState<EditItemsState, FormData>(updateItems, {});
  const rows = items.length + EXTRA_ROWS;
  const sent = state.values;
  const val = (name: string, fallback: string) => (sent ? (sent[name] ?? "") : fallback);
  const bad = (name: string) => (state.field === name ? { "aria-invalid": true, style: { borderColor: "var(--bad)" } } : {});

  return (
    <form action={action} key={JSON.stringify(sent ?? {})} className="card" style={{ marginTop: 10 }}>
      <input type="hidden" name="id" value={osId} />
      <input type="hidden" name="rows" value={rows} />
      {state.error ? (
        <div className="notice notice-error" role="alert">
          {state.error}
        </div>
      ) : null}
      <p className="muted" style={{ marginTop: 0 }}>
        Altere, inclua ou apague linhas (deixe a descrição vazia para remover). Parcelas já pagas ficam como estão; a diferença vai para as parcelas em aberto, e a cobrança do Asaas é ajustada sozinha.
      </p>
      <div className="row muted" style={{ fontSize: 12, marginBottom: 4, flexWrap: "nowrap" }}>
        <span style={{ width: 120 }}>Tipo</span>
        <span style={{ flex: 3 }}>Descrição</span>
        <span style={{ width: 70 }}>Qtd</span>
        <span style={{ width: 150 }}>Valor unitário (R$)</span>
      </div>
      {Array.from({ length: rows }, (_, i) => {
        const it = items[i];
        return (
          <div key={i} className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
            <select name={`item_kind_${i}`} aria-label={`Tipo do item ${i + 1}`} defaultValue={val(`item_kind_${i}`, it?.kind ?? "service")} style={{ width: 120 }}>
              <option value="service">Serviço</option>
              <option value="product">Produto</option>
            </select>
            <input
              name={`item_desc_${i}`}
              aria-label={`Descrição do item ${i + 1}`}
              placeholder={it ? "" : "Novo item"}
              defaultValue={val(`item_desc_${i}`, it?.description ?? "")}
              style={{ flex: 3 }}
              {...bad(`item_desc_${i}`)}
            />
            <input
              name={`item_qty_${i}`}
              inputMode="decimal"
              aria-label={`Quantidade do item ${i + 1}`}
              defaultValue={val(`item_qty_${i}`, it ? String(Number(it.quantity)).replace(".", ",") : "1")}
              style={{ width: 70 }}
              {...bad(`item_qty_${i}`)}
            />
            <input
              name={`item_price_${i}`}
              inputMode="decimal"
              aria-label={`Valor unitário do item ${i + 1}`}
              placeholder="150,00"
              defaultValue={val(`item_price_${i}`, it ? money(it.unit_price_cents) : "")}
              style={{ width: 150 }}
              {...bad(`item_price_${i}`)}
            />
          </div>
        );
      })}
      <div className="row" style={{ alignItems: "flex-end", marginTop: 12 }}>
        <div className="field" style={{ width: 200, marginBottom: 0 }}>
          <label htmlFor="edit_discount">Desconto (R$)</label>
          <input id="edit_discount" name="discount" inputMode="decimal" defaultValue={val("discount", money(discountCents))} {...bad("discount")} />
        </div>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Salvando..." : "Salvar itens"}
        </button>
      </div>
    </form>
  );
}
