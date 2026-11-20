import "server-only";
import { decryptSecret } from "./crypto";

/** Credentials of the device-connected WhatsApp (Z-API or Evolution API), as stored on the org. */
export type WaDevice = {
  wa_provider: string | null;
  wa_api_url: string | null;
  wa_instance: string | null;
  wa_api_token_encrypted: string | null;
  wa_client_token_encrypted: string | null;
};

export class WaSendError extends Error {}

const ZAPI = "https://api.z-api.io";

async function req(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  if (!res.ok) throw new WaSendError(`${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function canSend(o: WaDevice | null | undefined): boolean {
  if (!o?.wa_instance || !o.wa_api_token_encrypted) return false;
  if (o.wa_provider === "zapi") return true;
  return o.wa_provider === "evolution" && !!o.wa_api_url;
}

/** Sends a text message from the connected number. */
export async function sendWhatsApp(o: WaDevice, to: string, text: string): Promise<void> {
  if (!canSend(o)) throw new WaSendError("not_configured");
  const token = decryptSecret(o.wa_api_token_encrypted!);
  if (o.wa_provider === "zapi") {
    const client = o.wa_client_token_encrypted ? decryptSecret(o.wa_client_token_encrypted) : "";
    await req(`${ZAPI}/instances/${encodeURIComponent(o.wa_instance!)}/token/${encodeURIComponent(token)}/send-text`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(client ? { "Client-Token": client } : {}) },
      body: JSON.stringify({ phone: to, message: text }),
    });
    return;
  }
  await req(`${o.wa_api_url!.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(o.wa_instance!)}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: token },
    body: JSON.stringify({ number: to, text }),
  });
}

/** Points the provider's "message received" webhook to our URL. */
export async function setWhatsAppWebhook(p: { provider: string; apiUrl?: string | null; instance: string; token: string; clientToken?: string | null }, url: string): Promise<void> {
  if (p.provider === "zapi") {
    await req(`${ZAPI}/instances/${encodeURIComponent(p.instance)}/token/${encodeURIComponent(p.token)}/update-webhook-received`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(p.clientToken ? { "Client-Token": p.clientToken } : {}) },
      body: JSON.stringify({ value: url }),
    });
    return;
  }
  await req(`${String(p.apiUrl).replace(/\/+$/, "")}/webhook/set/${encodeURIComponent(p.instance)}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: p.token },
    body: JSON.stringify({ webhook: { enabled: true, url, byEvents: false, base64: false, events: ["MESSAGES_UPSERT"] } }),
  });
}
