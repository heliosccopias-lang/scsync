/**
 * Credit card reconciliation: reading statements (OFX/CSV), reading expenses sent to the WhatsApp robot,
 * and pairing the two. Pure functions only.
 * Sign convention everywhere: amount > 0 = purchase (you owe more), < 0 = refund/credit/payment.
 */
import { parseOfx } from "./ofx";
import { parseCsv, parseImportPrice } from "./catalog-import";

export type CardLine = { externalId: string; postedOn: string; description: string; amountCents: number; installment: string | null };
export type CardFile = { lines: CardLine[]; start: string | null; end: string | null; errors: string[] };

const INSTALLMENT = /(?:parc(?:ela)?\.?\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i;

function installmentOf(desc: string): string | null {
  const m = desc.match(INSTALLMENT);
  if (!m) return null;
  const [n, t] = [Number(m[1]), Number(m[2])];
  return n >= 1 && t >= 2 && n <= t && t <= 48 ? `${n}/${t}` : null;
}

/** Card OFX: banks write purchases as negative (debit on the card account); we flip to purchase > 0. */
export function parseCardOfx(text: string): CardFile {
  const st = parseOfx(text);
  const lines = st.transactions.map((t) => ({
    externalId: `ofx:${t.fitId}`,
    postedOn: t.postedOn,
    description: t.description,
    amountCents: -t.amountCents,
    installment: installmentOf(t.description),
  }));
  return { lines: dropBillPayments(lines), start: st.start, end: st.end, errors: [] };
}

const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, dd-mm-aaaa. */
export function parseDateBR(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo}-${d}`;
}

/**
 * Card CSV (Itaú, Bradesco, Santander, Nubank, Inter…): columns found by name — data, descrição/estabelecimento/lançamento/título, valor.
 * If most amounts are negative, the bank writes purchases as negative: flip.
 */
export function parseCardCsv(text: string): CardFile {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { lines: [], start: null, end: null, errors: ["O arquivo está vazio."] };
  const header = rows[0].map(n);
  const find = (...names: string[]) => header.findIndex((h) => names.some((x) => h === x || h.startsWith(x)));
  const cDate = find("data", "date", "dt");
  const cDesc = find("descricao", "estabelecimento", "lancamento", "historico", "title", "titulo", "description", "detalhe");
  const cAmount = find("valor", "amount", "vlr", "quantia");
  const cParc = find("parcela", "installment");
  if (cDate < 0 || cDesc < 0 || cAmount < 0) {
    return { lines: [], start: null, end: null, errors: ['Não achei as colunas "Data", "Descrição" e "Valor" no cabeçalho do arquivo.'] };
  }
  const raw: CardLine[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const date = parseDateBR(cells[cDate] ?? "");
    const desc = (cells[cDesc] ?? "").trim().replace(/\s+/g, " ");
    const rawAmount = (cells[cAmount] ?? "").trim();
    const negative = /^-|^\(|-$|\bD$/i.test(rawAmount.replace(/R\$\s*/, ""));
    const abs = parseImportPrice(rawAmount.replace(/[-()]|\s[DC]$/gi, ""));
    if (!date || !desc || abs === null || abs === 0) {
      if (cells.some((c) => c.trim())) errors.push(`Linha ${r + 1}: ignorada (data, descrição ou valor inválido).`);
      continue;
    }
    const parc = cParc >= 0 ? (cells[cParc] ?? "").trim() : "";
    raw.push({
      externalId: `csv:${date}|${abs}|${n(desc)}`,
      postedOn: date,
      description: desc,
      amountCents: negative ? -abs : abs,
      installment: installmentOf(parc) ?? installmentOf(desc),
    });
  }
  const negatives = raw.filter((l) => l.amountCents < 0).length;
  const lines = negatives > raw.length / 2 ? raw.map((l) => ({ ...l, amountCents: -l.amountCents })) : raw;
  // Same purchase twice on the same day: keep both with distinct ids.
  const seen = new Map<string, number>();
  for (const l of lines) {
    const k = seen.get(l.externalId) ?? 0;
    seen.set(l.externalId, k + 1);
    if (k) l.externalId = `${l.externalId}#${k + 1}`;
  }
  const dates = lines.map((l) => l.postedOn).sort();
  return { lines: dropBillPayments(lines), start: dates[0] ?? null, end: dates[dates.length - 1] ?? null, errors };
}

/** The payment of the previous bill shows up as a credit line; it is not an expense. */
function dropBillPayments(lines: CardLine[]): CardLine[] {
  return lines.filter((l) => !(l.amountCents < 0 && /pagamento|pgto|pag fatura|pagto/i.test(l.description)));
}

export function parseCardFile(fileName: string, text: string): CardFile {
  if (/\.ofx$/i.test(fileName) || /<OFX>|OFXHEADER/i.test(text.slice(0, 2000))) return parseCardOfx(text);
  return parseCardCsv(text);
}

// ---------------------------------------------------------------- WhatsApp messages

export type CardRef = { id: string; name: string; last4: string | null; aliases: string[] };
export type CategoryRef = { id: string; name: string; keywords: string[] };
export type ParsedExpense =
  | { ok: true; amountCents: number; spentOn: string; description: string; cardId: string | null; categoryId: string | null }
  | { ok: false; reason: string };

const MONEY = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\s*(?:\/|x\b|%|h\b|km\b))/i;

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reads messages like "gasolina 150,00", "almoço 45,90 ontem itau", "R$ 23,50 uber 12/11 cartão 1234".
 * Date: hoje (default), ontem, anteontem or dd/mm[/aaaa]. Card: by name, alias or final digits.
 * Category: first category whose keyword or name appears in the text.
 */
export function parseExpenseMessage(text: string, today: string, cards: CardRef[], categories: CategoryRef[]): ParsedExpense {
  let rest = ` ${text.replace(/\s+/g, " ").trim()} `;
  if (rest.trim().length < 3) return { ok: false, reason: "Mensagem vazia." };

  let spentOn = today;
  const dm = rest.match(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : today.slice(0, 4);
    const iso = parseDateBR(`${dm[1]}/${dm[2]}/${year}`);
    if (iso) {
      // "12/12" sent in January means last year.
      spentOn = !dm[3] && iso > today ? `${Number(year) - 1}${iso.slice(4)}` : iso;
      rest = rest.replace(dm[0], " ");
    }
  } else if (/\santeontem\s/i.test(rest)) {
    spentOn = addDaysISO(today, -2);
    rest = rest.replace(/\santeontem(?=\s)/i, " ");
  } else if (/\sontem\s/i.test(rest)) {
    spentOn = addDaysISO(today, -1);
    rest = rest.replace(/\sontem(?=\s)/i, " ");
  } else rest = rest.replace(/\shoje(?=\s)/i, " ");

  let cardId: string | null = null;
  const words = rest.toLowerCase();
  for (const c of cards) {
    const keys = [c.name, ...c.aliases, ...(c.last4 ? [c.last4] : [])].map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 3);
    const hit = keys.find((k) => n(words).includes(n(k)) && (k.length > 4 || new RegExp(`(^|\\W)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(words)));
    if (hit) {
      cardId = c.id;
      rest = rest.replace(new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
      break;
    }
  }
  if (!cardId && cards.length === 1) cardId = cards[0].id;
  rest = rest.replace(/\s(?:no |na |do |da )?(?:cart[aã]o|cred(?:ito)?|cr[eé]dito)(?=\s)/gi, " ");

  const mm = rest.match(MONEY);
  if (!mm) return { ok: false, reason: "Não achei o valor. Escreva, por exemplo: gasolina 150,00" };
  const amount = mm[1].includes(",") || /^\d{1,3}(\.\d{3})+$/.test(mm[1]) ? parseImportPrice(mm[1]) : parseImportPrice(mm[1].replace(".", ","));
  if (!amount || amount <= 0) return { ok: false, reason: "Valor inválido." };
  rest = rest.replace(mm[0], " ");

  const description = rest.replace(/\s(?:r\$|reais|de|no|na|em|com|dia|gastei|paguei|compra|comprei)(?=\s)/gi, " ").replace(/\s(?:r\$|reais|de|no|na|em|com|dia)(?=\s)/gi, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!description) return { ok: false, reason: "Diga com o que foi o gasto. Exemplo: gasolina 150,00" };

  const nd = ` ${n(description)} `;
  const textN = n(text);
  let categoryId: string | null = null;
  for (const cat of categories) {
    const keys = [...cat.keywords, cat.name].map(n).filter((k) => k.length >= 3);
    if (keys.some((k) => textN.includes(k) || nd.includes(k))) {
      categoryId = cat.id;
      break;
    }
  }
  return { ok: true, amountCents: amount, spentOn, description: description[0].toUpperCase() + description.slice(1), cardId, categoryId };
}

// ---------------------------------------------------------------- pairing

export type TxForMatch = { id: string; postedOn: string; amountCents: number; description: string; installment: string | null };
export type ExpenseForMatch = { id: string; spentOn: string; amountCents: number; description: string };

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

function similarity(a: string, b: string): number {
  const toks = (s: string) => new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const A = toks(a);
  const B = toks(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if ([...B].some((x) => x.startsWith(w) || w.startsWith(x))) common++;
  return common / Math.min(A.size, B.size);
}

/**
 * Score 0..100 for a statement line and an expense. Same amount is required; the card posts a few days later
 * (up to 5 days, or anything if the line is an installment 2/3 etc., whose purchase was months ago).
 */
export function matchScore(t: TxForMatch, e: ExpenseForMatch): number {
  if (t.amountCents !== e.amountCents) return 0;
  const later = dayDiff(t.postedOn, e.spentOn);
  const installmentLater = t.installment && !t.installment.startsWith("1/");
  if (!installmentLater && (later < -2 || later > 5)) return 0;
  const datePart = installmentLater ? 20 : 40 - Math.abs(later) * 6;
  return Math.round(50 + Math.max(0, datePart) + similarity(t.description, e.description) * 10);
}

/** Best pairs first, each line and each expense used once. */
export function pairCardLines(txs: TxForMatch[], expenses: ExpenseForMatch[], minScore = 60): { txId: string; expenseId: string; score: number }[] {
  const cand: { txId: string; expenseId: string; score: number }[] = [];
  for (const t of txs) for (const e of expenses) {
    const score = matchScore(t, e);
    if (score >= minScore) cand.push({ txId: t.id, expenseId: e.id, score });
  }
  cand.sort((a, b) => b.score - a.score);
  const usedT = new Set<string>();
  const usedE = new Set<string>();
  const out: typeof cand = [];
  for (const c of cand) {
    if (usedT.has(c.txId) || usedE.has(c.expenseId)) continue;
    usedT.add(c.txId);
    usedE.add(c.expenseId);
    out.push(c);
  }
  return out;
}

/** "2026-11" for a closing date. */
export const referenceOf = (closing: string) => closing.slice(0, 7);
