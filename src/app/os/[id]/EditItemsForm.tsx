"use client";

import { useActionState } from "react";
import { CatalogList, fillFromCatalog, type CatalogEntry } from "../nova/NewOrderForm";
import { updateItems, type EditItemsState } from "./items-action";
import { ItemsTable } from "@/components/ItemsTable";

type Item = { kind: string; description: string; quantity: number | string; unit_price_cents: number };

const EXTRA_ROWS = 3;

function money(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function EditItemsForm({
  osId,
  items,
  discountCents,
  catalog,
  adjustments,
  attendance,
}: {
  osId: string;
  items: Item[];
  discountCents: number;
  catalog: CatalogEntry[];
  adjustments: Record<string, number>;
  attendance: string;
}) {
  const [state, action, pending] = useActionState<EditItemsState, FormData>(updateItems, {});
  const rows = items.length + EXTRA_ROWS;
  const sent = state.values;
  const val = (name: string, fallback: string) => (sent ? (sent[name] ?? "") : fallback);
  const bad = (name: string) => (state.field === name ? { "aria-invalid": true, style: { borderColor: "var(--bad)" } } : {});

  return (
    <form action={action} key={JSON.stringify(sent ?? {})} className="card" style={{ marginTop: 10 }} onInput={(e) => fillFromCatalog(e, catalog, adjustments, attendance)}>
      <CatalogList catalog={catalog} />
      <input type="hidden" name="id" value={osId} />
      <input type="hidden" name="rows" value={rows} />
      {state.error ? (
        <div className="notice notice-error" role="alert">
          {state.error}
        </div>
      ) : null}
      <p className="muted" style={{ marginTop: 0 }}>
        Altere, inclua ou apague linhas (deixe a descrição vazia para remover). As parcelas são recalculadas com o novo total, mantendo vencimentos e forma. Depois de lançar as contas, a OS fica travada.
      </p>
      <ItemsTable
        rows={rows}
        initial={(i) => {
          const it = items[i];
          return {
            kind: val(`item_kind_${i}`, it?.kind ?? "service"),
            desc: val(`item_desc_${i}`, it?.description ?? ""),
            qty: val(`item_qty_${i}`, it ? String(Number(it.quantity)).replace(".", ",") : "1"),
            price: val(`item_price_${i}`, it ? money(it.unit_price_cents) : ""),
          };
        }}
        bad={bad}
        discountDefault={val("discount", money(discountCents))}
        discountId="edit_discount"
        firstPlaceholder=""
      />
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Salvando..." : "Salvar itens"}
        </button>
      </div>
    </form>
  );
}
