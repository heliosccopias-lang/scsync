// Minimal OFX reader for Brazilian bank statements (OFX 1.x SGML and 2.x XML).
// Reads only what reconciliation needs: account, period and transactions.

export type OfxTransaction = {
  fitId: string;
  postedOn: string; // YYYY-MM-DD
  amountCents: number; // signed: + credit, - debit
  type: string;
  description: string;
  counterpartDoc: string | null;
};

export type OfxStatement = {
  bankId: string | null;
  accountId: string | null;
  start: string | null;
  end: string | null;
  transactions: OfxTransaction[];
};

/** Decodes the file bytes: OFX from Brazilian banks is usually Windows-1252 (CHARSET:1252), sometimes UTF-8. */
export function decodeOfx(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 600)).toUpperCase();
  const utf8 = head.includes("ENCODING:UTF-8") || head.includes('ENCODING="UTF-8"') || head.includes("CHARSET:UTF-8");
  try {
    return new TextDecoder(utf8 ? "utf-8" : "windows-1252").decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

function tag(block: string, name: string): string | null {
  // <NAME>value  (SGML, no closing tag)  or  <NAME>value</NAME>  (XML)
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  if (!m) return null;
  const v = m[1].trim();
  return v === "" ? null : decodeEntities(v);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** OFX dates: YYYYMMDD[HHMMSS[.XXX]][[-3:BRT]]. Only the calendar date matters here. */
export function ofxDate(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** "-1.234,56", "1234.56", "-50" -> centavos. OFX should use a dot, but some banks send a comma. */
export function ofxAmountCents(v: string | null): number | null {
  if (!v) return null;
  let s = v.trim().replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace(/^[+-]/, "").split(".");
  const cents = Number(int) * 100 + Number((frac + "00").slice(0, 2)) + (Number(frac[2] ?? "0") >= 5 ? 1 : 0);
  return neg ? -cents : cents;
}

function findDoc(text: string): string | null {
  const cnpj = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/.exec(text);
  if (cnpj) return cnpj[1].replace(/\D/g, "");
  const cpf = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/.exec(text);
  if (cpf) return cpf[1].replace(/\D/g, "");
  return null;
}

export function parseOfx(text: string): OfxStatement {
  const body = text.slice(Math.max(0, text.search(/<OFX>/i)));
  const transactions: OfxTransaction[] = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m: RegExpExecArray | null;
  const seen = new Map<string, number>();
  while ((m = re.exec(body))) {
    const b = m[1];
    const postedOn = ofxDate(tag(b, "DTPOSTED"));
    const amountCents = ofxAmountCents(tag(b, "TRNAMT"));
    if (!postedOn || amountCents === null || amountCents === 0) continue;
    const name = tag(b, "NAME");
    const memo = tag(b, "MEMO");
    const description = [name, memo && memo !== name ? memo : null].filter(Boolean).join(" · ") || tag(b, "TRNTYPE") || "Lançamento";
    let fitId = tag(b, "FITID") ?? `${postedOn}|${amountCents}|${description}`;
    // some banks repeat FITID inside one file: keep each line distinct
    const n = seen.get(fitId) ?? 0;
    seen.set(fitId, n + 1);
    if (n > 0) fitId = `${fitId}#${n + 1}`;
    transactions.push({
      fitId,
      postedOn,
      amountCents,
      type: (tag(b, "TRNTYPE") ?? "").toUpperCase(),
      description,
      counterpartDoc: findDoc(`${name ?? ""} ${memo ?? ""}`),
    });
  }
  return {
    bankId: tag(body, "BANKID"),
    accountId: tag(body, "ACCTID"),
    start: ofxDate(tag(body, "DTSTART")),
    end: ofxDate(tag(body, "DTEND")),
    transactions,
  };
}
