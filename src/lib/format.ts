// Display helpers shared by screens and printouts.

export const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  cash: "Dinheiro",
  transfer: "Transferência",
  other: "A combinar",
};

export const ATTENDANCE_LABEL: Record<string, string> = { external: "Externo", internal: "Interno", warranty: "Garantia" };

export function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
}

export function fmtDoc(doc: string | null | undefined): string {
  if (!doc) return "—";
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

const UNITS = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function upTo999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (rest < 20) {
    if (rest) parts.push(UNITS[rest]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    parts.push(u ? `${TENS[t]} e ${UNITS[u]}` : TENS[t]);
  }
  return parts.join(" e ");
}

function integerWords(n: number): string {
  if (n === 0) return "zero";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const groups: string[] = [];
  if (millions) groups.push(millions === 1 ? "um milhão" : `${upTo999(millions)} milhões`);
  if (thousands) groups.push(thousands === 1 ? "mil" : `${upTo999(thousands)} mil`);
  if (rest) groups.push(upTo999(rest));
  if (groups.length === 1) return groups[0];
  const last = groups.pop()!;
  // "mil e cem", "mil e vinte", but "mil, duzentos e trinta" reads as "mil duzentos e trinta"
  const joiner = rest > 0 && (rest < 100 || rest % 100 === 0) ? " e " : " ";
  return groups.join(" ") + joiner + last;
}

/** Valor por extenso para recibos: 1250 -> "doze reais e cinquenta centavos". */
export function centsInWords(cents: number): string {
  const reais = Math.floor(cents / 100);
  const c = cents % 100;
  const parts: string[] = [];
  if (reais) {
    const w = integerWords(reais);
    const de = reais % 1_000_000 === 0 ? " de" : "";
    parts.push(`${w}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (c) parts.push(`${upTo999(c)} ${c === 1 ? "centavo" : "centavos"}`);
  return parts.length ? parts.join(" e ") : "zero reais";
}
