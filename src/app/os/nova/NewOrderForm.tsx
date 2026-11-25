"use client";

import { useActionState, useState, type FormEvent } from "react";
import { createOrder, type FormState } from "./actions";
import { LINES, START_LINES } from "./constants";
import { PrintSpecFields } from "@/components/PrintSpecFields";
import { readPrintSpec } from "@/lib/grafica";
import { ItemsTable } from "@/components/ItemsTable";
import { NewCustomerButton } from "@/components/NewCustomerButton";

export type CatalogEntry = { id: string; kind: string; name: string; price_cents: number };

export function NewOrderForm({
  customers,
  technicians,
  sectors = [],
  catalog,
  conditions,
  adjustments,
  today,
}: {
  customers: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  sectors?: { id: string; name: string }[];
  catalog: CatalogEntry[];
  conditions: { id: string; name: string }[];
  adjustments: Record<string, number>;
  today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrder, {});
  const v = state.values ?? {};
  const bad = (name: string) => (state.field === name ? { "aria-invalid": true, style: { borderColor: "var(--bad)" } } : {});
  // Re-mount the fields with the submitted values after an error, so nothing typed is lost.
  const formKey = JSON.stringify(v);
  // New-customer fields only show while "Novo cliente" is picked.
  const [customerId, setCustomerId] = useState(v.customer_id ?? "");
  const [customerList, setCustomerList] = useState(customers);

  return (
    <form action={action} key={formKey} noValidate onInput={(e) => fillFromCatalog(e, catalog, adjustments)}>
      <CatalogList catalog={catalog} />
      {state.error ? (
        <div className="notice notice-error" role="alert">
          {state.error}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Dados da OS</h2>
        <div className="os-head os-head-2t">
          <div className="field">
            <input type="hidden" name="attendance_type" value="external" />
            <span className="os-label">Tipo</span>
            <div className="seg" role="radiogroup" aria-label="Tipo">
              <label>
                <input type="radio" name="kind" value="order" defaultChecked={(v.kind ?? "order") === "order"} />
                Ordem de serviço
              </label>
              <label>
                <input type="radio" name="kind" value="quote" defaultChecked={v.kind === "quote"} />
                Orçamento
              </label>
            </div>
          </div>
          <div className="field">
            <label htmlFor="sector_id">Setor</label>
            <select id="sector_id" name="sector_id" defaultValue={v.sector_id ?? ""}>
              <option value="">— Nenhum —</option>
              {sectors.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="technician_id">Atendente</label>
            <select id="technician_id" name="technician_id" defaultValue={v.technician_id ?? ""}>
              <option value="">— Nenhum —</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="delivery_date">Previsão de entrega</label>
            <input id="delivery_date" name="delivery_date" type="date" defaultValue={v.delivery_date} />
          </div>
        </div>
        <div className={customerId === "final" ? "os-row os-cust-final" : "os-row os-cust-pick"}>
          <div className="field">
            <label htmlFor="customer_id">Cliente</label>
            <select id="customer_id" name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.currentTarget.value)} {...bad("customer_name")}>
              <option value="">— Escolha o cliente —</option>
              <option value="final">Consumidor final</option>
              {customerList
                .filter((c) => c.name !== "Consumidor final")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          {customerId === "final" ? (
            <>
              <div className="field">
                <label htmlFor="contact_name">Nome do cliente</label>
                <input id="contact_name" name="contact_name" defaultValue={v.contact_name} placeholder="Para identificar a OS" autoComplete="off" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="contact_phone">Telefone / WhatsApp</label>
                <input id="contact_phone" name="contact_phone" defaultValue={v.contact_phone} inputMode="tel" placeholder="(11) 99999-0000" autoComplete="off" maxLength={30} />
              </div>
            </>
          ) : null}
          <NewCustomerButton
            customers={customerList}
            onPick={setCustomerId}
            onCreated={(c) => setCustomerList((l) => [...l, c].sort((x, y) => x.name.localeCompare(y.name, "pt-BR")))}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Serviços e produtos</h2>
        <ItemsTable
          rows={LINES}
          start={START_LINES}
          initial={(i) => ({
            kind: v[`item_kind_${i}`] ?? "service",
            desc: v[`item_desc_${i}`] ?? "",
            qty: v[`item_qty_${i}`] ?? "1",
            price: v[`item_price_${i}`] ?? "",
          })}
          bad={bad}
          discountDefault={v.discount ?? ""}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <PrintSpecFields d={readPrintSpec((k) => v[k] ?? "", v.art_approved_at ?? "")} />
        <div className="os-row os-row-2 os-notes">
          <div className="field">
            <label htmlFor="notes">Observações (saem na OS do cliente)</label>
            <textarea id="notes" name="notes" rows={2} defaultValue={v.notes} />
          </div>
          <div className="field">
            <label htmlFor="internal_notes">Observações internas (só a equipe vê)</label>
            <textarea id="internal_notes" name="internal_notes" rows={2} defaultValue={v.internal_notes} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Pagamento</h2>
        <div className={conditions.length ? "os-row os-pay os-pay-cond" : "os-row os-pay"}>
          {conditions.length ? (
            <div className="field">
              <label htmlFor="condition_id">Condição de pagamento</label>
              <select id="condition_id" name="condition_id" defaultValue={v.condition_id ?? ""}>
                <option value="">— Parcelas iguais mensais —</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="method">Forma</label>
            <select id="method" name="method" defaultValue={v.method ?? "pix"}>
              <option value="pix">Pix</option>
              <option value="boleto">Boleto (com QR Pix)</option>
              <option value="credit_card">Cartão de crédito</option>
              <option value="other">Cliente escolhe</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="installments">Parcelas</label>
            <input id="installments" name="installments" type="number" min={1} max={48} defaultValue={v.installments ?? "1"} {...bad("installments")} />
          </div>
          <div className="field">
            <label htmlFor="first_due">1º vencimento</label>
            <input id="first_due" name="first_due" type="date" defaultValue={v.first_due ?? today} {...bad("first_due")} />
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          As parcelas são mensais e iguais; a última leva os centavos do arredondamento.
        </p>
      </div>

      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Salvando..." : "Salvar OS"}
      </button>
    </form>
  );
}

/** Suggestions for the description fields, from the service/product catalog. */
export function CatalogList({ catalog }: { catalog: CatalogEntry[] }) {
  return (
    <datalist id="catalog-items">
      {catalog.map((c) => (
        <option key={c.id} value={c.name}>
          {c.kind === "service" ? "Serviço" : "Produto"} · {(c.price_cents / 100).toFixed(2).replace(".", ",")}
        </option>
      ))}
    </datalist>
  );
}

/** When a description matches a catalog name, fill kind and unit price (price only if still empty). */
export function fillFromCatalog(e: FormEvent<HTMLFormElement>, catalog: CatalogEntry[], adjustments: Record<string, number> = {}, attendance?: string) {
  const t = e.target as HTMLInputElement;
  const m = /^item_desc_(\d+)$/.exec(t.name ?? "");
  if (!m) return;
  const hit = catalog.find((c) => c.name.toLowerCase() === t.value.trim().toLowerCase());
  if (!hit) return;
  const form = e.currentTarget;
  const price = form.elements.namedItem(`item_price_${m[1]}`) as HTMLInputElement | null;
  const kind = form.elements.namedItem(`item_kind_${m[1]}`) as HTMLSelectElement | null;
  // price list by type of attendance (e.g. Interno -20%, Garantia +30%)
  const att = attendance ?? (form.elements.namedItem("attendance_type") as HTMLSelectElement | null)?.value ?? "external";
  const pct = adjustments[att] ?? 0;
  const cents = Math.round(hit.price_cents * (1 + pct / 100));
  if (price && !price.value) price.value = (cents / 100).toFixed(2).replace(".", ",");
  if (kind) kind.value = hit.kind;
}
