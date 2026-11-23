import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print/PrintButton";
import "@/components/print/print.css";
import type { Question } from "@/lib/checklist";
import { requireOrg } from "@/lib/session";

// Blank checklist to print and fill by hand; the answers are typed into the system later.
export default async function PrintChecklist({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const { sb, orgId } = await requireOrg();
  const { data: run } = await sb
    .from("checklist_runs")
    .select("checklist_id, checklists(name), service_orders(number, customers(name), orgs(name))")
    .eq("id", runId)
    .eq("org_id", orgId)
    .eq("service_order_id", id)
    .maybeSingle();
  if (!run) notFound();
  const { data: qrows } = await sb.from("checklist_questions").select("*").eq("checklist_id", run.checklist_id).order("position");
  const questions = (qrows ?? []) as Question[];
  const os = run.service_orders as unknown as { number: number; customers: { name: string }; orgs: { name: string } };
  const name = (run.checklists as unknown as { name: string }).name;

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link href={`/os/${id}/checklist/${runId}`} className="btn btn-secondary">
          ← Voltar
        </Link>
        <PrintButton />
      </div>
      <article className="sheet">
        <header className="sheet-head">
          <div className="sheet-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sheet-logo" src="/brand/scsync-logo-compact.svg" alt="SCsync" />
            <div>
              <div className="company">{os.orgs.name}</div>
              <div className="muted">
                {os.customers.name}
              </div>
            </div>
          </div>
          <div className="doc-id">
            <div className="doc-title">CHECKLIST</div>
            <div className="doc-number" style={{ fontSize: 16 }}>
              {name}
            </div>
            <div className="muted">OS nº {os.number}</div>
          </div>
        </header>
        {questions.map((q, i) => (
          <section key={q.id} className="box" style={{ breakInside: "avoid" }}>
            <h3 style={{ textTransform: "none", fontSize: 13, color: "#1d1c1a", letterSpacing: 0 }}>
              {i + 1}. {q.prompt}
              {q.required ? " *" : ""}
            </h3>
            {q.type === "single" || q.type === "multi" ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px" }}>
                {q.options.map((o) => (
                  <span key={o}>
                    {q.type === "single" ? "○" : "☐"} {o}
                  </span>
                ))}
              </div>
            ) : null}
            {q.type === "rating" ? <div>☐ 1 &nbsp; ☐ 2 &nbsp; ☐ 3 &nbsp; ☐ 4 &nbsp; ☐ 5</div> : null}
            {q.type === "upload" ? <div className="muted">Anexar foto/arquivo no sistema.</div> : null}
            <div style={{ borderBottom: "1px solid #ccc", height: 22, marginTop: 6 }} />
          </section>
        ))}
        <footer className="signatures">
          <div>
            <div className="line" />
            Técnico
          </div>
          <div>
            <div className="line" />
            Data
          </div>
        </footer>
      </article>
    </div>
  );
}
