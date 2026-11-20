/** WhatsApp robot: reads inbound payloads from the common providers into one shape. Pure functions only. */

export type Inbound = { id: string; from: string; name: string | null; text: string };
export type Provider = "generic" | "meta" | "zapi" | "evolution";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const digits = (v: unknown) => str(v).replace(/@.*$/, "").replace(/\D/g, "");

/** Detects the provider by the payload shape and returns the text messages (ignores our own, groups and media without caption). */
export function readInbound(body: unknown): { provider: Provider; messages: Inbound[] } {
  const b = o(body);

  // Meta WhatsApp Cloud API
  if (b.object === "whatsapp_business_account" && Array.isArray(b.entry)) {
    const messages: Inbound[] = [];
    for (const entry of b.entry as unknown[]) {
      for (const change of (o(entry).changes as unknown[]) ?? []) {
        const value = o(o(change).value);
        const names = new Map(((value.contacts as unknown[]) ?? []).map((c) => [digits(o(c).wa_id), str(o(o(c).profile).name) || null]));
        for (const m of (value.messages as unknown[]) ?? []) {
          const mm = o(m);
          const text = str(o(mm.text).body) || str(o(mm.image).caption) || str(o(mm.document).caption);
          if (!text) continue;
          const from = digits(mm.from);
          messages.push({ id: str(mm.id), from, name: names.get(from) ?? null, text });
        }
      }
    }
    return { provider: "meta", messages };
  }

  // Evolution API
  if (typeof b.event === "string" && b.data) {
    const d = o(b.data);
    const key = o(d.key);
    const msg = o(d.message);
    const text = str(msg.conversation) || str(o(msg.extendedTextMessage).text) || str(o(msg.imageMessage).caption);
    const jid = str(key.remoteJid);
    if (!/messages[._]upsert/i.test(b.event) || key.fromMe === true || jid.endsWith("@g.us") || !text) return { provider: "evolution", messages: [] };
    return { provider: "evolution", messages: [{ id: str(key.id), from: digits(jid), name: str(d.pushName) || null, text }] };
  }

  // Z-API
  if ("messageId" in b && "phone" in b) {
    const text = str(o(b.text).message) || str(o(b.image).caption);
    if (b.fromMe === true || b.isGroup === true || !text) return { provider: "zapi", messages: [] };
    return { provider: "zapi", messages: [{ id: str(b.messageId), from: digits(b.phone), name: str(b.senderName) || str(b.chatName) || null, text }] };
  }

  // Generic: { id, from, text, name? } — for n8n, Make, Twilio adapters etc.
  const text = str(b.text) || str(b.message) || str(b.body);
  const from = digits(b.from ?? b.phone);
  const id = str(b.id ?? b.messageId) || `${from}:${text}:${str(b.timestamp)}`;
  return { provider: "generic", messages: text && from ? [{ id, from, name: str(b.name) || null, text }] : [] };
}

/**
 * Brazilian mobile numbers arrive with or without the 9th digit and with or without 55.
 * Compares DDD + last 8 digits.
 */
export function phoneKey(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}

export const HELP_TEXT = [
  "Para registrar uma despesa do cartão, mande o gasto e o valor. Exemplos:",
  "• gasolina 150,00",
  "• almoço 45,90 ontem itau",
  "• papel couchê 1.250,00 12/11 bradesco",
  "Data: hoje (padrão), ontem, anteontem ou dd/mm. Cartão: nome ou 4 últimos dígitos.",
  "Mande *cancelar* para apagar a última despesa que você enviou.",
].join("\n");
