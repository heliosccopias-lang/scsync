import { describe, expect, it } from "vitest";
import { paidInfo } from "../src/lib/stone";

describe("Stone Connect paid order", () => {
  it("debit card from the POS webhook shape", () => {
    expect(
      paidInfo({
        id: "or_1",
        status: "paid",
        charges: [{ id: "ch_1", status: "paid", amount: 1990, paid_amount: 1990, payment_method: "cash", paid_at: "2026-11-22T20:10:00Z", metadata: { scheme_name: "MasterCard", account_funding_source: "debit", authorization_code: "A1B2", installment_quantity: 1 } }],
      }),
    ).toEqual({ amountCents: 1990, method: "debit_card", installments: null, brand: "MasterCard", authCode: "A1B2", paidOn: "2026-11-22" });
  });
  it("credit in installments, pix, and nothing paid", () => {
    expect(paidInfo({ id: "o", status: "paid", charges: [{ id: "c", status: "paid", amount: 30000, metadata: { account_funding_source: "credit", installment_quantity: 3 } }] })).toMatchObject({ method: "credit_card", installments: 3, amountCents: 30000 });
    expect(paidInfo({ id: "o", status: "paid", charges: [{ id: "c", status: "paid", amount: 500, payment_method: "pix" }] })).toMatchObject({ method: "pix" });
    expect(paidInfo({ id: "o", status: "pending", charges: [{ id: "c", status: "pending", amount: 500 }] })).toBeNull();
  });
});

import { mpPaidInfo } from "../src/lib/mercadopago";

describe("Mercado Pago Point paid order", () => {
  it("processed credit order with installments; created is not paid", () => {
    expect(
      mpPaidInfo({
        id: "ORD1",
        status: "processed",
        last_updated_date: "2026-11-22T21:00:00Z",
        transactions: { payments: [{ id: "PAY1", amount: "150.00", paid_amount: "150.00", status: "processed", reference_id: "ref9", payment_method: { id: "master", type: "credit_card", installments: 3 } }] },
      }),
    ).toEqual({ amountCents: 15000, method: "credit_card", installments: 3, brand: "master", authCode: "ref9", paidOn: "2026-11-22" });
    expect(mpPaidInfo({ id: "ORD2", status: "created", transactions: { payments: [{ id: "P", status: "created" }] } })).toBeNull();
  });
});
