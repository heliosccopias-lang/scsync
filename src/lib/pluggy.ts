import "server-only";
import type { CardLine } from "./card";

/** Pluggy (Open Finance aggregator) — only what card reconciliation needs. Docs: https://docs.pluggy.ai */
const BASE = "https://api.pluggy.ai";

export class PluggyError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { apiKey?: string } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.apiKey ? { "X-API-KEY": init.apiKey } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const msg = (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new PluggyError(msg, res.status);
  }
  return body as T;
}

export async function pluggyApiKey(clientId: string, clientSecret: string): Promise<string> {
  const r = await call<{ apiKey: string }>("/auth", { method: "POST", body: JSON.stringify({ clientId, clientSecret }) });
  return r.apiKey;
}

export type PluggyAccount = { id: string; type: string; subtype?: string; name: string; number?: string; marketingName?: string | null };

export async function pluggyCreditAccounts(apiKey: string, itemId: string): Promise<PluggyAccount[]> {
  const r = await call<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`, { apiKey });
  return (r.results ?? []).filter((a) => a.type === "CREDIT" || a.subtype === "CREDIT_CARD");
}

type PluggyTx = {
  id: string;
  date: string;
  description: string;
  amount: number;
  creditCardMetadata?: { installmentNumber?: number; totalInstallments?: number } | null;
};

/** Card transactions in a date range. Pluggy: positive amount = purchase on a credit card, same as ours. */
export async function pluggyCardLines(apiKey: string, accountId: string, from: string, to: string): Promise<CardLine[]> {
  const lines: CardLine[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await call<{ results: PluggyTx[]; totalPages: number }>(
      `/transactions?accountId=${encodeURIComponent(accountId)}&from=${from}&to=${to}&pageSize=500&page=${page}`,
      { apiKey },
    );
    for (const t of r.results ?? []) {
      const cents = Math.round(Number(t.amount) * 100);
      if (!cents) continue;
      const m = t.creditCardMetadata;
      lines.push({
        externalId: `pluggy:${t.id}`,
        postedOn: String(t.date).slice(0, 10),
        description: t.description || "Lançamento",
        amountCents: cents,
        installment: m?.installmentNumber && m?.totalInstallments && m.totalInstallments > 1 ? `${m.installmentNumber}/${m.totalInstallments}` : null,
      });
    }
    if (!r.totalPages || page >= r.totalPages) break;
  }
  return lines.filter((l) => !(l.amountCents < 0 && /pagamento|pgto|pag fatura|pagto/i.test(l.description)));
}
