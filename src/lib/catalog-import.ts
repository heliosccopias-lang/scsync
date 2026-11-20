/** Import of services/products from a spreadsheet saved as CSV (Excel in Portuguese or Google Sheets). */

export type Kind = "service" | "product";
/** price_cents/unit null = cell left blank: keep what the item already has (new items get 0 and "un"). */
export type ImportItem = { kind: Kind; name: string; unit: string | null; price_cents: number | null };
export type ImportPlan = { items: ImportItem[]; errors: string[]; total: number };

export const IMPORT_MAX_ROWS = 3000;

/** Excel in Portuguese saves CSV as Windows-1252; Google Sheets and newer Excel as UTF-8. */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** RFC 4180 parser with the delimiter guessed from the header line (; from Excel PT-BR, , from Sheets, or tab). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const HEADERS: Record<string, string[]> = {
  kind: ["tipo", "categoria", "servicoouproduto"],
  name: ["nome", "descricao", "produto", "servico", "item", "nomedoitem"],
  unit: ["unidade", "un", "und", "unid"],
  price: ["preco", "valor", "precovenda", "precodevenda", "valorunitario", "precounitario", "precors", "valorrs"],
};

function parseKind(v: string, fallback: Kind): Kind | null {
  const k = norm(v);
  if (!k) return fallback;
  if (["servico", "servicos", "s", "service", "serv"].includes(k)) return "service";
  if (["produto", "produtos", "p", "product", "prod"].includes(k)) return "product";
  return null;
}

/** Price as written in Brazil (150 · 150,00 · 1.500,00 · R$ 150,00) or with a dot decimal (150.00). */
export function parseImportPrice(v: string): number | null {
  const s = v.replace(/R\$|\s| /g, "");
  if (!s) return 0;
  let n: string;
  if (s.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
    n = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = s.replace(/\./g, "");
  else n = s;
  if (!/^\d+(\.\d{1,2})?$/.test(n)) return null;
  const [i, f = ""] = n.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
}

/** Turns CSV rows (first row = header) into items to save, with readable errors by line number. */
export function planCatalogImport(rows: string[][], defaultKind: Kind): ImportPlan {
  const errors: string[] = [];
  if (rows.length < 2) return { items: [], errors: ["A planilha está vazia ou só tem o cabeçalho."], total: 0 };
  const header = rows[0].map(norm);
  const col = (field: string) => header.findIndex((h) => HEADERS[field].includes(h));
  const cName = col("name");
  const cKind = col("kind");
  const cUnit = col("unit");
  const cPrice = col("price");
  if (cName < 0) return { items: [], errors: ['Não achei a coluna "Nome" no cabeçalho. Use o modelo: Tipo; Nome; Unidade; Preço.'], total: 0 };
  if (rows.length - 1 > IMPORT_MAX_ROWS) return { items: [], errors: [`A planilha tem ${rows.length - 1} linhas; o máximo por importação é ${IMPORT_MAX_ROWS}.`], total: 0 };

  const byKey = new Map<string, ImportItem>();
  for (let r = 1; r < rows.length; r++) {
    const line = r + 1;
    const get = (c: number) => (c >= 0 ? (rows[r][c] ?? "").trim() : "");
    const name = get(cName).replace(/\s+/g, " ");
    if (!name) {
      errors.push(`Linha ${line}: sem nome.`);
      continue;
    }
    if (name.length > 200) {
      errors.push(`Linha ${line}: nome com mais de 200 caracteres.`);
      continue;
    }
    const kind = parseKind(get(cKind), defaultKind);
    if (!kind) {
      errors.push(`Linha ${line}: tipo "${get(cKind)}" não reconhecido (use Serviço ou Produto).`);
      continue;
    }
    const rawPrice = get(cPrice);
    const price = rawPrice ? parseImportPrice(rawPrice) : null;
    if (rawPrice && price === null) {
      errors.push(`Linha ${line}: preço "${get(cPrice)}" inválido.`);
      continue;
    }
    const unit = get(cUnit).slice(0, 10) || null;
    byKey.set(`${kind}|${name.toLowerCase()}`, { kind, name, unit, price_cents: price });
  }
  return { items: [...byKey.values()], errors, total: rows.length - 1 };
}

export const TEMPLATE_CSV =
  "﻿" +
  ["Tipo;Nome;Unidade;Preço", "Serviço;Criação de arte;un;80,00", "Produto;Cartão de visita 9x5 couchê 300g 4x4 (milheiro);mil;150,00", "Produto;Impressão A4 colorida;fl;2,50"].join("\r\n") +
  "\r\n";
