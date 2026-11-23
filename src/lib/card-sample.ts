/**
 * Sample card statement for testing the WhatsApp robot without a real bank: the expenses told to the robot
 * plus the cases a real statement brings (purchase nobody told, installment, annual fee, refund, last bill paid).
 * Pure: used by the test page and the tests.
 */
export type SampleExpense = { spentOn: string; amountCents: number; description: string };
export type SampleRow = { date: string; description: string; amountCents: number };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const clamp = (iso: string, from: string, to: string) => (iso < from ? from : iso > to ? to : iso);

export function sampleStatement(expenses: SampleExpense[], cycle: { from: string; closing: string }): SampleRow[] {
  const { from, closing } = cycle;
  const rows: SampleRow[] = [];
  // Last bill paid: comes on every statement and must be left out by the import.
  rows.push({ date: from, description: "PAGAMENTO EFETUADO - OBRIGADO", amountCents: -123456 });
  expenses
    .filter((e) => e.spentOn >= addDays(from, -3) && e.spentOn <= closing)
    .forEach((e, i) => {
      // Banks often post a day later and write the merchant name, not what the person typed.
      const date = clamp(i % 2 ? addDays(e.spentOn, 1) : e.spentOn, from, closing);
      rows.push({ date, description: `${e.description.toUpperCase().slice(0, 40)} *LOJA`, amountCents: e.amountCents });
    });
  rows.push({ date: clamp(addDays(from, 4), from, closing), description: "POSTO SHELL AV BRASIL", amountCents: 21000 });
  rows.push({ date: clamp(addDays(from, 6), from, closing), description: "PAPELARIA CENTRAL PARC 02/03", amountCents: 8990 });
  rows.push({ date: clamp(addDays(from, 9), from, closing), description: "ESTORNO COMPRA NAO RECONHECIDA", amountCents: -2500 });
  rows.push({ date: clamp(addDays(closing, -2), from, closing), description: "ANUIDADE DIFERENCIADA 03/12", amountCents: 1990 });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

const brl = (cents: number) => {
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100).toLocaleString("pt-BR")},${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${s}` : s;
};
const br = (iso: string) => iso.split("-").reverse().join("/");

/** The same rows as the CSV a Brazilian internet banking exports (";" and comma decimals). */
export function sampleStatementCsv(rows: SampleRow[]): string {
  return ["Data;Descrição;Valor", ...rows.map((r) => `${br(r.date)};${r.description.replace(/;/g, ",")};${brl(r.amountCents)}`)].join("\r\n") + "\r\n";
}
