// Money is always integer centavos. Formatting and parsing live here only.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number | bigint | null | undefined): string {
  return brl.format(Number(cents ?? 0) / 100);
}

/** Parses "1.234,56", "1234,56", "1234.56" or "1234" into centavos. Returns null if invalid. */
export function parseBRL(input: string): number | null {
  const s = input.replace(/[R$\s]/g, "").trim();
  if (!s) return null;
  let normalized: string;
  if (s.includes(",")) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = s;
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [int, frac = ""] = normalized.replace("-", "").split(".");
  const cents = Number(int) * 100 + Number((frac + "00").slice(0, 2));
  return normalized.startsWith("-") ? -cents : cents;
}

/** Splits a total into n installments; the last one takes the rounding remainder. */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("total must be positive centavos");
  if (!Number.isInteger(n) || n < 1 || n > 48) throw new Error("installments must be 1..48");
  const base = Math.floor(totalCents / n);
  const parts = Array.from({ length: n }, () => base);
  parts[n - 1] += totalCents - base * n;
  return parts;
}

/** Adds whole months to an ISO date (YYYY-MM-DD), clamping to the month's last day. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const targetMonth = m - 1 + months;
  const year = y + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Today's date in São Paulo as YYYY-MM-DD (never the server's UTC date). */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

export function centsToReais(cents: number): number {
  return Math.round(cents) / 100;
}
