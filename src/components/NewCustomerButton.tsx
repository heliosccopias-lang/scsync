"use client";

import { useRef, useState, useTransition } from "react";
import { quickCustomer, type QuickCustomerInput, type QuickCustomerResult } from "@/app/cadastros/clientes/quick-actions";

const EMPTY: QuickCustomerInput = { name: "", cpf_cnpj: "", phone: "", email: "", cep: "", street: "", number: "", complement: "", district: "", city: "", state: "" };
const normName = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * "+ Novo cliente": a floating form (name, CPF/CNPJ, phone, e-mail and address, with street/city filled from the CEP)
 * that saves the customer right away and hands it back with onPick. Warns when the customer already exists.
 * Its fields have no name attribute, so they never travel with the surrounding form.
 */
export function NewCustomerButton({
  customers,
  onPick,
  onCreated,
}: {
  customers: { id: string; name: string }[];
  onPick: (id: string) => void;
  onCreated: (c: { id: string; name: string }) => void;
}) {
  const box = useRef<HTMLDetailsElement>(null);
  const [f, setF] = useState<QuickCustomerInput>(EMPTY);
  const [error, setError] = useState("");
  const [dupe, setDupe] = useState<QuickCustomerResult["existing"] | null>(null);
  const [cepNote, setCepNote] = useState("");
  const [saving, start] = useTransition();
  const sameName = f.name.trim() ? customers.find((c) => normName(c.name) === normName(f.name)) : undefined;

  const set = (k: keyof QuickCustomerInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    if (k === "name" || k === "cpf_cnpj" || k === "phone") setDupe(null);
    setF((old) => ({ ...old, [k]: value }));
  };

  function close() {
    setF(EMPTY);
    setDupe(null);
    setError("");
    setCepNote("");
    if (box.current) box.current.open = false;
  }
  function pick(id: string) {
    onPick(id);
    close();
  }

  // Street, district, city and state from the CEP (ViaCEP, public), when they are still empty.
  async function lookupCep() {
    const cep = (f.cep ?? "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepNote("Buscando endereço…");
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (j.erro) return setCepNote("CEP não encontrado: preencha o endereço.");
      setF((old) => ({
        ...old,
        street: old.street || j.logradouro || "",
        district: old.district || j.bairro || "",
        city: old.city || j.localidade || "",
        state: old.state || j.uf || "",
      }));
      setCepNote("");
    } catch {
      setCepNote("Não foi possível buscar o CEP: preencha o endereço.");
    }
  }

  function save(force = false) {
    setError("");
    start(async () => {
      const r = await quickCustomer({ ...f, force });
      if (r.existing) return setDupe(r.existing);
      if (r.error || !r.id) return setError(r.error ?? "Não foi possível cadastrar o cliente.");
      onCreated({ id: r.id, name: r.name! });
      pick(r.id);
    });
  }

  const input = (k: keyof QuickCustomerInput, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, cls = "") => (
    <div className={`field ${cls}`}>
      <label htmlFor={`nc_${k}`}>{label}</label>
      <input id={`nc_${k}`} value={(f[k] as string) ?? ""} onChange={set(k)} autoComplete="off" {...extra} />
    </div>
  );

  return (
    <details className="popover new-customer" ref={box}>
      <summary className="btn btn-secondary">+ Novo cliente</summary>
      <div
        className="card popover-panel"
        style={{ position: "absolute", zIndex: 5, width: 520, textAlign: "left" }}
        onKeyDown={(e) => {
          // Enter saves the customer instead of submitting the OS or the sale.
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            save();
          }
        }}
      >
        <button type="button" className="popover-close" data-close aria-label="Fechar">
          ✕
        </button>
        <strong>Novo cliente</strong>
        {dupe ? (
          <div className="notice notice-warn" role="alert" style={{ margin: "8px 0" }}>
            <strong>Cliente já cadastrado</strong> com {dupe.match === "documento" ? "este CPF/CNPJ" : dupe.match === "nome" ? "este nome" : "este telefone"}: <strong>{dupe.name}</strong>.
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <button type="button" className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => pick(dupe.id)}>
                Usar este cliente
              </button>
              {dupe.match !== "documento" ? (
                <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => save(true)} disabled={saving}>
                  É outra pessoa: cadastrar
                </button>
              ) : null}
            </div>
          </div>
        ) : sameName ? (
          <div className="notice notice-warn" style={{ margin: "8px 0" }}>
            Já existe <strong>{sameName.name}</strong> no cadastro.{" "}
            <button type="button" className="linklike" onClick={() => pick(sameName.id)}>
              Usar este cliente
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="notice notice-error" role="alert" style={{ margin: "8px 0" }}>
            {error}
          </div>
        ) : null}
        <div className="nc-grid">
          {input("name", "Nome *", {}, "nc-span2")}
          {input("cpf_cnpj", "CPF ou CNPJ", { inputMode: "numeric" })}
          {input("phone", "Celular / WhatsApp", { inputMode: "tel" })}
          {input("email", "E-mail", { type: "email" }, "nc-span4")}
        </div>
        <div className="nc-sep">Endereço</div>
        <div className="nc-grid nc-addr">
          {input("cep", "CEP", { inputMode: "numeric", onBlur: lookupCep, placeholder: "00000-000" })}
          {input("street", "Rua / avenida", {}, "nc-span3")}
          {input("number", "Número")}
          {input("complement", "Complemento", {}, "nc-span3")}
          {input("district", "Bairro", {}, "nc-span2")}
          {input("city", "Cidade")}
          {input("state", "UF", { maxLength: 2 })}
        </div>
        {cepNote ? (
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            {cepNote}
          </p>
        ) : null}
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => save()} disabled={saving}>
            {saving ? "Salvando…" : "Cadastrar e usar"}
          </button>
          <button type="button" className="btn btn-secondary" data-close>
            Cancelar
          </button>
        </div>
      </div>
    </details>
  );
}
