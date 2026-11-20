"use client";

import { useActionState, type FormEvent } from "react";
import { createOrder, type FormState } from "./actions";
import { LINES } from "./constants";
import { PrintSpecFields } from "@/components/PrintSpecFields";
import { readPrintSpec } from "@/lib/grafica";

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

  return (
    <form action={action} key={formKey} noValidate onInput={(e) => fillFromCatalog(e, catalog, adjustments)}>
      <CatalogList catalog={catalog} />
      {state.error ? (
        <div className="notice notice-error" role="alert">
          {state.error}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Dados da OS</h2>
        <div className="grid2">
          <div className="field">
            <label htmlFor="kind">Tipo</label>
            <select id="kind" name="kind" defaultValue={v.kind ?? "order"}>
              <option value="order">Ordem de serviço</option>
              <option value="quote">Orçamento</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="attendance_type">Atendimento</label>
            <select id="attendance_type" name="attendance_type" defaultValue={v.attendance_type ?? "external"}>
              <option value="external">Externo</option>
              <option value="internal">Interno</option>
              <option value="warranty">Garantia</option>
            </select>
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="technician_id">Técnico responsável</label>
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
          {technicians.length > 1 ? (
            <div className="field">
              <label htmlFor="second_technician_id">Segundo técnico (divide a comissão)</label>
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
        </div>
        <div className="field">
          <label htmlFor="customer_id">Cliente cadastrado</label>
          <select id="customer_id" name="customer_id" defaultValue={v.customer_id ?? ""}>
            <option value="">— Novo cliente (preencha abaixo) —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="customer_name">Nome do novo cliente</label>
            <input id="customer_name" name="customer_name" defaultValue={v.customer_name} {...bad("customer_name")} />
          </div>
          <div className="field">
            <label htmlFor="customer_doc">CPF/CNPJ (o Asaas exige para cobrar)</label>
            <input id="customer_doc" name="customer_doc" inputMode="numeric" defaultValue={v.customer_doc} {...bad("customer_doc")} />
          </div>
          <div className="field">
            <label htmlFor="customer_email">E-mail</label>
            <input id="customer_email" name="customer_email" type="email" defaultValue={v.customer_email} />
          </div>
          <div className="field">
            <label htmlFor="customer_phone">Celular</label>
            <input id="customer_phone" name="customer_phone" inputMode="tel" defaultValue={v.customer_phone} />
          </div>
        </div>
        <PrintSpecFields d={readPrintSpec((k) => v[k] ?? "", v.art_approved_at ?? "")} />
        <div className="grid2">
          <div className="field">
            <label htmlFor="notes">Observações (saem na OS do cliente)</label>
            <textarea id="notes" name="notes" defaultValue={v.notes} />
          </div>
          <div className="field">
            <label htmlFor="internal_notes">Observações internas (só a equipe vê)</label>
            <textarea id="internal_notes" name="internal_notes" defaultValue={v.internal_notes} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Serviços e produtos</h2>
        <div className="row muted" style={{ fontSize: 12, marginBottom: 4, flexWrap: "nowrap" }}>
          <span style={{ width: 120 }}>Tipo</span>
          <span style={{ flex: 3 }}>Descrição</span>
          <span style={{ width: 70 }}>Qtd</span>
          <span style={{ width: 150 }}>Valor unitário (R$)</span>
        </div>
        {Array.from({ length: LINES }, (_, i) => (
          <div key={i} className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
            <select name={`item_kind_${i}`} aria-label={`Tipo do item ${i + 1}`} defaultValue={v[`item_kind_${i}`] ?? "service"} style={{ width: 120 }}>
              <option value="service">Serviço</option>
              <option value="product">Produto</option>
            </select>
            <input name={`item_desc_${i}`} list="catalog-items" autoComplete="off" placeholder={i === 0 ? "Digite ou escolha do catálogo" : ""} aria-label={`Descrição do item ${i + 1}`} defaultValue={v[`item_desc_${i}`]} style={{ flex: 3 }} {...bad(`item_desc_${i}`)} />
            <input name={`item_qty_${i}`} inputMode="decimal" aria-label={`Quantidade do item ${i + 1}`} defaultValue={v[`item_qty_${i}`] ?? "1"} style={{ width: 70 }} {...bad(`item_qty_${i}`)} />
            <input name={`item_price_${i}`} inputMode="decimal" placeholder="150,00" aria-label={`Valor unitário do item ${i + 1}`} defaultValue={v[`item_price_${i}`]} style={{ width: 150 }} {...bad(`item_price_${i}`)} />
          </div>
        ))}
        <div className="field" style={{ maxWidth: 200, marginTop: 12 }}>
          <label htmlFor="discount">Desconto (R$)</label>
          <input id="discount" name="discount" inputMode="decimal" placeholder="0,00" defaultValue={v.discount} {...bad("discount")} />
        </div>
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
