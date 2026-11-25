import { osStatusLabel } from "@/components/Shell";
import { ATTENDANCE_LABEL, METHOD_LABEL, fmtDate, fmtDoc } from "@/lib/format";
import { formatBRL } from "@/lib/money";

export type SheetData = {
  os: {
    number: number;
    contact_name?: string | null;
    contact_phone?: string | null;
    kind: string;
    status: string;
    os_date: string;
    attendance_type: string;
    delivery_date: string | null;
    equipment: string | null;
    problem: string | null;
    technical_report: string | null;
    notes: string | null;
    internal_notes?: string | null;
    receipt_notes: string | null;
    print_format?: string | null;
    print_paper?: string | null;
    print_colors?: string | null;
    finishing?: string[] | null;
    art_approved?: boolean;
    art_approved_at?: string | null;
    warranty: string | null;
    services_cents: number;
    products_cents: number;
    expenses_cents: number;
    discount_cents: number;
    total_cents: number;
  };
  org: { name: string; cnpj: string | null };
  customer: { name: string; cpf_cnpj: string | null; email: string | null; phone: string | null } | null;
  technician: string | null;
  sector?: string | null;
  items: { id: string; kind: string; description: string; quantity: number; unit_price_cents: number; total_cents: number; rejected: boolean }[];
  installments: { id: string; number: number; due_date: string; method: string; amount_cents: number }[];
};

/**
 * A4 sheet for an OS or quote.
 * mode "customer": prices, payment terms, signatures. mode "production": for the workshop, no prices, internal notes shown.
 */
export function ServiceOrderSheet({ data, mode = "customer" }: { data: SheetData; mode?: "customer" | "production" }) {
  const { os, org, customer: c, items, installments } = data;
  // "Consumidor final" with a walk-in contact: print the person's name and phone.
  const walkIn = c?.name === "Consumidor final" && (os.contact_name || os.contact_phone);
  const production = mode === "production";
  const title = production ? "ORDEM DE PRODUÇÃO" : os.kind === "quote" ? "ORÇAMENTO" : "ORDEM DE SERVIÇO";
  const services = items.filter((i) => i.kind === "service" && !i.rejected);
  const products = items.filter((i) => i.kind === "product" && !i.rejected);

  return (
    <article className="sheet">
      <header className="sheet-head">
        <div className="sheet-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sheet-logo" src="/brand/scsync-logo-compact.svg" alt="SCsync" />
          <div>
            <div className="company">{org.name}</div>
            {org.cnpj ? <div className="muted">CNPJ {org.cnpj}</div> : null}
          </div>
        </div>
        <div className="doc-id">
          <div className="doc-title">{title}</div>
          <div className="doc-number">Nº {os.number}</div>
          <div className="muted">
            Emissão {fmtDate(os.os_date)} · {osStatusLabel(os.status)}
          </div>
        </div>
      </header>

      <section className="box">
        <h3>Cliente</h3>
        <div className="grid">
          <div>
            <span>Nome</span>
            <strong>{walkIn && os.contact_name ? `${os.contact_name} (consumidor final)` : c?.name}</strong>
          </div>
          <div>
            <span>CPF/CNPJ</span>
            {fmtDoc(c?.cpf_cnpj)}
          </div>
          <div>
            <span>Telefone</span>
            {(walkIn ? os.contact_phone : c?.phone) ?? "—"}
          </div>
          <div>
            <span>E-mail</span>
            {c?.email ?? "—"}
          </div>
        </div>
      </section>

      <section className="box inline-row">
        <h3>Atendimento</h3>
        <div>
          <span>Tipo</span> {ATTENDANCE_LABEL[os.attendance_type] ?? os.attendance_type}
        </div>
        <div>
          <span>Previsão de entrega</span> {fmtDate(os.delivery_date)}
        </div>
        {data.sector ? (
          <div>
            <span>Setor</span> {data.sector}
          </div>
        ) : null}
        {data.technician ? (
          <div>
            <span>Atendente</span> {data.technician}
          </div>
        ) : null}
        {os.technical_report ? (
          <div className="wide">
            <span>Laudo técnico</span> <span style={{ whiteSpace: "pre-wrap", color: "inherit", fontSize: "inherit" }}>{os.technical_report}</span>
          </div>
        ) : null}
      </section>

      <section className="box">
        <h3>Trabalho gráfico</h3>
        <div className="grid grid4">
          <div>
            <span>Formato / tamanho</span>
            {os.print_format ?? "—"}
          </div>
          <div>
            <span>Papel</span>
            {os.print_paper ?? "—"}
          </div>
          <div>
            <span>Cores</span>
            {os.print_colors ?? "—"}
          </div>
          <div>
            <span>Acabamento</span>
            {os.finishing?.length ? os.finishing.join(", ") : "—"}
          </div>
          <div className="wide">
            <span>Arte</span>
            {os.art_approved ? `Aprovada pelo cliente${os.art_approved_at ? ` em ${fmtDate(os.art_approved_at)}` : ""}` : "Não aprovada — não imprimir sem aprovação"}
          </div>
        </div>
      </section>

      {(
        [
          ["Serviços", services],
          ["Produtos", products],
        ] as const
      ).map(([label, rows]) =>
        rows.length ? (
          <section key={label}>
            <h3>{label}</h3>
            <table>
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th className="num">Qtd</th>
                  {production ? <th>Feito</th> : null}
                  {!production ? <th className="num">Unitário</th> : null}
                  {!production ? <th className="num">Total</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td className="num">{Number(it.quantity).toLocaleString("pt-BR")}</td>
                    {production ? <td style={{ width: 60 }}>☐</td> : null}
                    {!production ? <td className="num">{formatBRL(it.unit_price_cents)}</td> : null}
                    {!production ? <td className="num">{formatBRL(it.total_cents)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null,
      )}

      {!production ? (
        <section className="totals">
          <div>
            <span>Serviços</span>
            {formatBRL(os.services_cents)}
          </div>
          <div>
            <span>Produtos</span>
            {formatBRL(os.products_cents)}
          </div>
          {os.expenses_cents > 0 ? (
            <div>
              <span>Despesas</span>
              {formatBRL(os.expenses_cents)}
            </div>
          ) : null}
          {os.discount_cents > 0 ? (
            <div>
              <span>Desconto</span>− {formatBRL(os.discount_cents)}
            </div>
          ) : null}
          <div className="grand">
            <span>Total</span>
            {formatBRL(os.total_cents)}
          </div>
        </section>
      ) : null}

      {!production && installments.length ? (
        <section>
          <h3>Condições de pagamento</h3>
          <table>
            <thead>
              <tr>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Forma</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.number}/{installments.length}
                  </td>
                  <td>{fmtDate(i.due_date)}</td>
                  <td>{METHOD_LABEL[i.method] ?? i.method}</td>
                  <td className="num">{formatBRL(i.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {os.notes ? (
        <section className="box">
          <h3>Observações</h3>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{os.notes}</p>
        </section>
      ) : null}

      {production && os.internal_notes ? (
        <section className="box">
          <h3>Observações internas</h3>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{os.internal_notes}</p>
        </section>
      ) : null}

      <footer className="signatures">
        <div>
          <div className="line" />
          {production ? "Responsável pela produção" : org.name}
        </div>
        <div>
          <div className="line" />
          {production ? "Conferido por" : c?.name}
        </div>
      </footer>
    </article>
  );
}
