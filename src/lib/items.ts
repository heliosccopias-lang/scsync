import { parseBRL, parseQuantity } from "./money";

export type ItemInput = { kind: "service" | "product"; description: string; quantity: number; unit_price_cents: number };
export type ItemsResult = { items: ItemInput[] } | { error: string; field: string };

/** Reads item rows named item_kind_N, item_desc_N, item_qty_N, item_price_N. Empty rows are skipped. */
export function parseItemRows(values: Record<string, string>, rows: number): ItemsResult {
  const s = (k: string) => (values[k] ?? "").trim();
  const items: ItemInput[] = [];
  for (let i = 0; i < rows; i++) {
    const description = s(`item_desc_${i}`);
    const rawPrice = s(`item_price_${i}`);
    if (!description) {
      if (rawPrice) return { error: `Item ${i + 1}: falta a descrição.`, field: `item_desc_${i}` };
      continue;
    }
    const quantity = parseQuantity(s(`item_qty_${i}`));
    if (quantity === null) return { error: `Item ${i + 1}: quantidade inválida. Use números, por exemplo 1, 1.000 ou 2,5.`, field: `item_qty_${i}` };
    if (!rawPrice) return { error: `Item ${i + 1}: informe o valor unitário, por exemplo 150,00.`, field: `item_price_${i}` };
    const unit = parseBRL(rawPrice);
    if (unit === null || unit < 0) {
      return { error: `Item ${i + 1}: valor "${rawPrice}" não reconhecido. Use, por exemplo, 150,00 ou 1.500,00.`, field: `item_price_${i}` };
    }
    items.push({ kind: s(`item_kind_${i}`) === "product" ? "product" : "service", description, quantity, unit_price_cents: unit });
  }
  if (items.length === 0) return { error: "Inclua pelo menos um serviço ou produto, com descrição e valor.", field: "item_desc_0" };
  return { items };
}
