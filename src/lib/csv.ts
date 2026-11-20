export type ReportTable = { key: string; title: string; note?: string; columns: string[]; numeric: boolean[]; rows: (string | number)[][]; raw: (string | number)[][] };

/** CSV that opens correctly in Excel in Portuguese: semicolon separator, comma decimals, UTF-8 BOM. */
export function toCsv(t: ReportTable): string {
  const cell = (v: string | number) => {
    const s = typeof v === "number" ? String(v).replace(".", ",") : /^-?\d+\.\d+$/.test(v) ? v.replace(".", ",") : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [t.columns, ...t.raw].map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}
