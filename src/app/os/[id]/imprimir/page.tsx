import Link from "next/link";
import { notFound } from "next/navigation";
import { osStatusLabel } from "@/components/Shell";
import { formatBRL } from "@/lib/money";
import { requireOrg } from "@/lib/session";
import { PrintButton } from "./PrintButton";
import "./print.css";

const METHOD: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  cash: "Dinheiro",
  transfer: "Transferência",
  other: "A combinar",
};

const ATTENDANCE: Record<string, string> = { external: "Externo", internal: "Interno", warranty: "Garantia" };

function fmtDate(d: string | null) {
  return d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—";
}

function fmtDoc(doc: string | null) {
  if (!doc) return "—";
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

export default async function PrintServiceOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, orgId } = await requireOrg();

  const { data: os } = await sb
    .from("service_orders")
    .select("*, customers(name, cpf_cnpj, email, phone, address), orgs(name, cnpj)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!os) notFound();

  const [{ data: items }, { data: installments }] = await Promise.all([
    sb.from("service_order_items").select("*").eq("service_order_id", id).order("position"),
    sb.from("service_order_installments").select("*").eq("service_order_id", id).order("number"),
  ]);

  const org = os.orgs as unknown as { name: string; cnpj: string | null };
  const c = os.customers as unknown as { name: string; cpf_cnpj: string | null; email: string | null; phone: string | null };
  const title = os.kind === "quote" ? "ORÇAMENTO" : "ORDEM DE SERVIÇO";
  const services = (items ?? []).filter((i) => i.kind === "service" && !i.rejected);
  const products = (items ?? []).filter((i) => i.kind === "product" && !i.rejected);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link href={`/os/${id}`} className="btn btn-secondary">
          ← Voltar
        </Link>
        <PrintButton />
      </div>

      <article className="sheet">
        <header className="sheet-head">
          <div>
            <div className="company">{org?.name}</div>
            {org?.cnpj ? <div className="muted">CNPJ {org.cnpj}</div> : null}
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
              <strong>{c?.name}</strong>
            </div>
            <div>
              <span>CPF/CNPJ</span>
              {fmtDoc(c?.cpf_cnpj)}
            </div>
            <div>
              <span>Telefone</span>
              {c?.phone ?? "—"}
            </div>
            <div>
              <span>E-mail</span>
              {c?.email ?? "—"}
            </div>
          </div>
        </section>

        <section className="box">
          <h3>Atendimento</h3>
          <div className="grid">
            <div>
              <span>Tipo</span>
              {ATTENDANCE[os.attendance_type] ?? os.attendance_type}
            </div>
            <div>
              <span>Previsão de entrega</span>
              {fmtDate(os.delivery_date)}
            </div>
            <div className="wide">
              <span>Equipamento</span>
              {os.equipment ?? "—"}
            </div>
            <div className="wide">
              <span>Problema relatado</span>
              {os.problem ?? "—"}
            </div>
            {os.technical_report ? (
              <div className="wide">
                <span>Laudo técnico</span>
                {os.technical_report}
              </div>
            ) : null}
          </div>
        </section>

        {[
          ["Serviços", services],
          ["Produtos", products],
        ].map(([label, rows]) =>
          (rows as typeof services).length ? (
            <section key={label as string}>
              <h3>{label as string}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th className="num">Qtd</th>
                    <th className="num">Unitário</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows as typeof services).map((it) => (
                    <tr key={it.id}>
                      <td>{it.description}</td>
                      <td className="num">{Number(it.quantity).toLocaleString("pt-BR")}</td>
                      <td className="num">{formatBRL(it.unit_price_cents)}</td>
                      <td className="num">{formatBRL(it.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null,
        )}

        <section className="totals">
          <div>
            <span>Serviços</span>
            {formatBRL(os.services_cents)}
          </div>
          <div>
            <span>Produtos</span>
            {formatBRL(os.products_cents)}
          </div>
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

        {(installments ?? []).length ? (
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
                {(installments ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.number}/{installments!.length}
                    </td>
                    <td>{fmtDate(i.due_date)}</td>
                    <td>{METHOD[i.method] ?? i.method}</td>
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

        {os.warranty ? (
          <section className="box">
            <h3>Garantia</h3>
            <p style={{ margin: 0 }}>{os.warranty}</p>
          </section>
        ) : null}

        <footer className="signatures">
          <div>
            <div className="line" />
            {org?.name}
          </div>
          <div>
            <div className="line" />
            {c?.name}
          </div>
        </footer>
      </article>
    </div>
  );
}
