import { describe, expect, it } from "vitest";
import { phoneKey, readInbound } from "../src/lib/whatsapp";

describe("WhatsApp inbound payloads", () => {
  it("Meta Cloud API", () => {
    const body = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ wa_id: "5511987654321", profile: { name: "Ana" } }], messages: [{ id: "wamid.1", from: "5511987654321", type: "text", text: { body: "gasolina 150" } }] } }] }] };
    expect(readInbound(body)).toEqual({ provider: "meta", messages: [{ id: "wamid.1", from: "5511987654321", name: "Ana", text: "gasolina 150" }] });
  });
  it("Z-API, ignoring our own messages and groups", () => {
    expect(readInbound({ messageId: "z1", phone: "5511987654321", fromMe: false, senderName: "Ana", text: { message: "uber 20" } }).messages).toEqual([{ id: "z1", from: "5511987654321", name: "Ana", text: "uber 20" }]);
    expect(readInbound({ messageId: "z2", phone: "5511987654321", fromMe: true, text: { message: "x 1" } }).messages).toEqual([]);
    expect(readInbound({ messageId: "z3", phone: "123-group", isGroup: true, text: { message: "x 1" } }).messages).toEqual([]);
  });
  it("Evolution API", () => {
    const body = { event: "messages.upsert", data: { key: { remoteJid: "5511987654321@s.whatsapp.net", fromMe: false, id: "e1" }, pushName: "Ana", message: { conversation: "lanche 12,50" } } };
    expect(readInbound(body)).toEqual({ provider: "evolution", messages: [{ id: "e1", from: "5511987654321", name: "Ana", text: "lanche 12,50" }] });
  });
  it("generic JSON", () => {
    expect(readInbound({ id: "g1", from: "+55 (11) 98765-4321", text: "papel 10" }).messages[0]).toMatchObject({ id: "g1", from: "5511987654321" });
  });
  it("matches Brazilian numbers with or without 55 and the 9th digit", () => {
    expect(phoneKey("5511987654321")).toBe(phoneKey("1187654321"));
    expect(phoneKey("+55 11 98765-4321")).toBe(phoneKey("11 9 8765 4321"));
  });
});
