/** Texts and timing of the WhatsApp notices to customers (payment reminders and "OS pronta"). Pure: no I/O. */

export type ReminderKind = "reminder_before" | "reminder_due" | "reminder_overdue";
export type NoticeKind = ReminderKind | "os_ready";

export const KIND_LABEL: Record<NoticeKind, string> = {
  reminder_before: "Lembrete antes do vencimento",
  reminder_due: "Lembrete no dia do vencimento",
  reminder_overdue: "Aviso de atraso",
  os_ready: "OS pronta",
};

export const DEFAULT_TPL_REMINDER = [
  "Olá, {cliente}! Aqui é da {empresa}.",
  "{situacao}: {referencia}, no valor de {valor}, com vencimento em {vencimento}.",
  "{pagamento}",
  "Se já pagou, por favor desconsidere esta mensagem. Obrigado!",
].join("\n");

export const DEFAULT_TPL_READY = [
  "Olá, {cliente}! Aqui é da {empresa}.",
  "Seu pedido (OS nº {os}) está pronto para retirada.",
  "{pagamento}",
  "Qualquer dúvida, é só responder esta mensagem. Obrigado!",
].join("\n");

/** The placeholders a template can use, shown on the settings page. */
export const PLACEHOLDERS = ["{cliente}", "{empresa}", "{os}", "{referencia}", "{valor}", "{vencimento}", "{situacao}", "{pagamento}", "{link}"];

/**
 * Which reminder (if any) an open installment gets today.
 * before: due within the next `before` days (not today); due: due today; overdue: `after` or more days late (up to 30).
 */
export function reminderKind(dueDate: string, today: string, before: number, after: number): ReminderKind | null {
  const days = Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days === 0) return "reminder_due";
  if (days > 0) return before > 0 && days <= before ? "reminder_before" : null;
  const late = -days;
  return late >= after && late <= 30 ? "reminder_overdue" : null;
}

export const SITUATION: Record<ReminderKind, string> = {
  reminder_before: "Lembrete de pagamento",
  reminder_due: "Seu pagamento vence hoje",
  reminder_overdue: "Identificamos um pagamento em aberto",
};

/** Fills {placeholders}; unknown ones stay as typed. Empty lines left by empty values are dropped. */
export function render(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n")
    .trim();
}

/** "Pague por este link…" from a live Asaas charge, or the OS page link, or nothing. */
export function paymentLines(p: { invoiceUrl?: string | null; pixPayload?: string | null; osUrl?: string | null; open?: boolean }): string {
  const lines: string[] = [];
  if (p.invoiceUrl) lines.push(`Pague por Pix, boleto ou cartão neste link:\n${p.invoiceUrl}`);
  if (p.pixPayload) lines.push(`Ou use o Pix copia e cola:\n${p.pixPayload}`);
  if (!lines.length && p.osUrl) lines.push(`Veja os detalhes${p.open ? " e o valor" : ""} aqui:\n${p.osUrl}`);
  return lines.join("\n");
}

/** First name, for a friendlier greeting ("Maria Souza" -> "Maria"). */
export function firstName(name: string | null | undefined): string {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}
