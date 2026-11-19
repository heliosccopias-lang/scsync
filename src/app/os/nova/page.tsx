import { redirect } from "next/navigation";
import { Notice, Shell } from "@/components/Shell";
import { addMonths, parseBRL, splitInstallments, todayInSaoPaulo } from "@/lib/money";
import { requireOrg } from "@/lib/session";

const LINES = 4;

async function createOrder(form: FormData) {
  "use server";
  const { sb, orgId } = await requireOrg();
  const fail = (msg: string) => redirect(`/os/nova?error=${encodeURIComponent(msg)}`);
  const s = (k: string) => String(form.get(k) ?? "").trim();

  // Customer: existing or new
  let customerId = s("customer_id");
  if (!customerId) {
    const name = s("customer_name");
    const doc = s("customer_doc").replace(/\D/g, "");
    if (!name) fail("Informe o cliente.");
    if (doc && doc.length !== 11 && doc.length !== 14) fail("CPF/CNPJ inválido.");
    const { data, error } = await sb
      .from("customers")
      .insert({ org_id: orgId, name, cpf_cnpj: doc || null, email: s("customer_email") || null, phone: s("customer_phone") || null })
      .select("id")
      .single();
    if (error || !data) fail(error?.code === "23505" ? "Já existe um cliente com este CPF/CNPJ. Selecione-o na lista." : "Não foi possível salvar o cliente.");
    customerId = data!.id;
  }

  const items: { kind: string; description: string; quantity: number; unit_price_cents: number }[] = [];
  for (let i = 0; i < LINES; i++) {
    const description = s(`item_desc_${i}`);
    if (!description) continue;
    const quantity = Number(s(`item_qty_${i}`).replace(",", ".") || "1");
    const unit = parseBRL(s(`item_price_${i}`));
    if (!(quantity > 0) || unit === null || unit < 0) fail(`Confira quantidade e valor do item ${i + 1}.`);
    items.push({ kind: s(`item_kind_${i}`) === "product" ? "product" : "service", description, quantity, unit_price_cents: unit! });
  }
  if (items.length === 0) fail("Inclua pelo menos um serviço ou produto.");

  const discount = parseBRL(s("discount") || "0");
  if (discount === null || discount < 0) fail("Desconto inválido.");
  const total = items.reduce((acc, it) => acc + Math.round(it.quantity * it.unit_price_cents), 0) - discount!;
  if (total <= 0) fail("O total da OS precisa ser maior que zero.");

  const n = Number(s("installments") || "1");
  const firstDue = s("first_due") || todayInSaoPaulo();
  const method = s("method") || "pix";
  let installments: { due_date: string; amount_cents: number; method: string }[];
  try {
    installments = splitInstallments(total, n).map((amount, i) => ({ due_date: addMonths(firstDue, i), amount_cents: amount, method }));
  } catch {
    fail("Número de parcelas inválido.");
  }

  const { data: osId, error } = await sb.rpc("create_service_order", {
    p_org: orgId,
    p: {
      customer_id: customerId,
      kind: s("kind") === "quote" ? "quote" : "order",
      attendance_type: s("attendance_type") || "external",
      equipment: s("equipment") || null,
      problem: s("problem") || null,
      notes: s("notes") || null,
      discount_cents: discount,
      items,
      installments: installments!,
    },
  });
  if (error || !osId) fail("Não foi possível salvar a OS.");
  redirect(`/os/${osId}`);
}

export default async function NewServiceOrderPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { sb, orgId, orgName } = await requireOrg();
  const { error } = await searchParams;
  const { data: customers } = await sb.from("customers").select("id, name").eq("org_id", orgId).order("name").limit(500);

  return (
    <Shell orgName={orgName}>
      <h1>Nova ordem de serviço</h1>
      <Notice error={error} />
      <form action={createOrder}>
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Dados da OS</h2>
          <div className="grid2">
            <div className="field">
              <label htmlFor="kind">Tipo</label>
              <select id="kind" name="kind">
                <option value="order">Ordem de serviço</option>
                <option value="quote">Orçamento</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="attendance_type">Atendimento</label>
              <select id="attendance_type" name="attendance_type" defaultValue="external">
                <option value="external">Externo</option>
                <option value="internal">Interno</option>
                <option value="warranty">Garantia</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="customer_id">Cliente cadastrado</label>
            <select id="customer_id" name="customer_id" defaultValue="">
              <option value="">— Novo cliente (preencha abaixo) —</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="customer_name">Nome do novo cliente</label>
              <input id="customer_name" name="customer_name" />
            </div>
            <div className="field">
              <label htmlFor="customer_doc">CPF/CNPJ (exigido pelo Asaas para cobrar)</label>
              <input id="customer_doc" name="customer_doc" inputMode="numeric" />
            </div>
            <div className="field">
              <label htmlFor="customer_email">E-mail</label>
              <input id="customer_email" name="customer_email" type="email" />
            </div>
            <div className="field">
              <label htmlFor="customer_phone">Celular</label>
              <input id="customer_phone" name="customer_phone" inputMode="tel" />
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="equipment">Equipamento</label>
              <input id="equipment" name="equipment" />
            </div>
            <div className="field">
              <label htmlFor="problem">Problema relatado</label>
              <input id="problem" name="problem" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="notes">Observações</label>
            <textarea id="notes" name="notes" />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Serviços e produtos</h2>
          {Array.from({ length: LINES }, (_, i) => (
            <div key={i} className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
              <select name={`item_kind_${i}`} aria-label={`Tipo do item ${i + 1}`} style={{ width: 120 }}>
                <option value="service">Serviço</option>
                <option value="product">Produto</option>
              </select>
              <input name={`item_desc_${i}`} placeholder="Descrição" aria-label={`Descrição do item ${i + 1}`} style={{ flex: 3 }} />
              <input name={`item_qty_${i}`} placeholder="Qtd" defaultValue="1" aria-label={`Quantidade do item ${i + 1}`} style={{ width: 70 }} />
              <input name={`item_price_${i}`} placeholder="Valor unit. (R$)" aria-label={`Valor do item ${i + 1}`} style={{ width: 150 }} />
            </div>
          ))}
          <div className="field" style={{ maxWidth: 200, marginTop: 12 }}>
            <label htmlFor="discount">Desconto (R$)</label>
            <input id="discount" name="discount" placeholder="0,00" />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Pagamento</h2>
          <div className="grid2">
            <div className="field">
              <label htmlFor="method">Forma</label>
              <select id="method" name="method" defaultValue="pix">
                <option value="pix">Pix</option>
                <option value="boleto">Boleto (com QR Pix)</option>
                <option value="credit_card">Cartão de crédito</option>
                <option value="other">Cliente escolhe</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="installments">Parcelas</label>
              <input id="installments" name="installments" type="number" min={1} max={48} defaultValue={1} />
            </div>
            <div className="field">
              <label htmlFor="first_due">1º vencimento</label>
              <input id="first_due" name="first_due" type="date" defaultValue={todayInSaoPaulo()} />
            </div>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            As parcelas são mensais e iguais; a última leva os centavos do arredondamento.
          </p>
        </div>

        <button className="btn btn-primary">Salvar OS</button>
      </form>
    </Shell>
  );
}
