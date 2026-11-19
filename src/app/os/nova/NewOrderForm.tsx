"use client";

import { useActionState } from "react";
import { createOrder, type FormState } from "./actions";
import { LINES } from "./constants";

export function NewOrderForm({ customers, today }: { customers: { id: string; name: string }[]; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrder, {});
  const v = state.values ?? {};
  const bad = (name: string) => (state.field === name ? { "aria-invalid": true, style: { borderColor: "var(--bad)" } } : {});
  // Re-mount the fields with the submitted values after an error, so nothing typed is lost.
  const formKey = JSON.stringify(v);

  return (
    <form action={action} key={formKey} noValidate>
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
        <div className="grid2">
          <div className="field">
            <label htmlFor="equipment">Equipamento</label>
            <input id="equipment" name="equipment" defaultValue={v.equipment} />
          </div>
          <div className="field">
            <label htmlFor="problem">Problema relatado</label>
            <input id="problem" name="problem" defaultValue={v.problem} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="notes">Observações</label>
          <textarea id="notes" name="notes" defaultValue={v.notes} />
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
            <input name={`item_desc_${i}`} placeholder={i === 0 ? "Ex.: Troca de tela" : ""} aria-label={`Descrição do item ${i + 1}`} defaultValue={v[`item_desc_${i}`]} style={{ flex: 3 }} {...bad(`item_desc_${i}`)} />
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
