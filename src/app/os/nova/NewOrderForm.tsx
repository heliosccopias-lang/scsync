"use client";

import { useActionState, useState, type FormEvent } from "react";
import { createOrder, type FormState } from "./actions";
import { LINES } from "./constants";
import { PrintSpecFields } from "@/components/PrintSpecFields";
import { readPrintSpec } from "@/lib/grafica";
import { ItemsTable } from "@/components/ItemsTable";

export type CatalogEntry = { id: string; kind: string; name: string; price_cents: number };

export function NewOrderForm({
  customers,
  technicians,
  catalog,
  conditions,
  adjustments,
  today,
}: {
  customers: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
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
        <div className={technicians.length > 1 ? "os-head os-head-2t" : "os-head"}>
          <div className="field">
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
            <span className="os-label">Atendimento</span>
            <div className="seg" role="radiogroup" aria-label="Atendimento">
              {[
                ["external", "Externo"],
                ["internal", "Interno"],
                ["warranty", "Garantia"],
              ].map(([val, label]) => (
                <label key={val}>
                  <input type="radio" name="attendance_type" value={val} defaultChecked={(v.attendance_type ?? "external") === val} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="technician_id">Técnico</label>
            <select id="technician_id" name="technician_id" defaultValue={v.technician_id ?? ""}>
              <option value="">— Nenhum —</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {technicians.length > 1 ? (
            <div className="field">
              <label htmlFor="second_technician_id" title="O segundo técnico divide a comissão">2º técnico (comissão)</label>
              <select id="second_technician_id" name="second_technician_id" defaultValue={v.second_technician_id ?? ""}>
                <option value="">— Nenhum —</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="delivery_date">Previsão de entrega</label>
            <input id="delivery_date" name="delivery_date" type="date" defaultValue={v.delivery_date} />
          </div>
        </div>
        <div className={customerId ? "os-row os-row-1" : "os-row os-cust"}>
          <div className="field">
            <label htmlFor="customer_id">Cliente</label>
            <select id="customer_id" name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.currentTarget.value)}>
              <option value="">— Novo cliente —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {!customerId ? (
            <>
              <div className="field">
                <label htmlFor="customer_name">Nome do novo cliente</label>
                <input id="customer_name" name="customer_name" defaultValue={v.customer_name} {...bad("customer_name")} />
              </div>
              <div className="field">
                <label htmlFor="customer_doc" title="O Asaas exige CPF/CNPJ para cobrar">
                  CPF/CNPJ <span className="muted">(para cobrar)</span>
                </label>
                <input id="customer_doc" name="customer_doc" inputMode="numeric" defaultValue={v.customer_doc} {...bad("customer_doc")} />
              </div>
              <div className="field">
                <label htmlFor="customer_phone">Celular</label>
                <input id="customer_phone" name="customer_phone" inputMode="tel" defaultValue={v.customer_phone} />
              </div>
              <div className="field">
                <label htmlFor="customer_email">E-mail</label>
                <input id="customer_email" name="customer_email" type="email" defaultValue={v.customer_email} />
              </div>
            </>
          ) : null}
        </div>
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
        <h2 style={{ marginTop: 0 }}>Serviços e produtos</h2>
        <ItemsTable
          rows={LINES}
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
        <h2 style={{ marginTop: 0 }}>Pagamento</h2>
        {conditions.length ? (
          <div className="field">
            <label htmlFor="condition_id">Condição de pagamento</label>
            <select id="condition_id" name="condition_id" defaultValue={v.condition_id ?? ""}>
              <option value="">— Definir abaixo (parcelas iguais mensais) —</option>
              {conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="grid2">
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
        <p className="muted" style={{ margin: 0 }}>
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
