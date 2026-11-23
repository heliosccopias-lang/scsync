import { headers } from "next/headers";
import { ROLES } from "@/lib/access";
import { PLANS } from "@/lib/plans";
import { startPreview, stopPreview } from "@/app/visualizar/actions";

const small = { padding: "4px 6px", fontSize: 13, width: "auto" } as const;

/** Owner's "Visualizar como": pick a profile and/or a plan and see the screens exactly as they would. */
export async function PreviewForm({ role, plan, compact }: { role?: string | null; plan?: string | null; compact?: boolean }) {
  const back = (await headers()).get("x-pathname") ?? "/";
  return (
    <form action={startPreview} className="row" style={{ gap: 6, flexWrap: compact ? "wrap" : "nowrap", alignItems: "center" }}>
      <input type="hidden" name="back" value={back} />
      <select name="role" defaultValue={role ?? ""} aria-label="Perfil para visualizar" style={small}>
        <option value="">Perfil: Dono (tudo)</option>
        {ROLES.filter((r) => r.key !== "custom").map((r) => (
          <option key={r.key} value={r.key}>
            Perfil: {r.label}
          </option>
        ))}
      </select>
      <select name="plan" defaultValue={plan ?? ""} aria-label="Plano para visualizar" style={small}>
        <option value="">Plano: o atual da conta</option>
        <option value="trial">Plano: período de teste (tudo liberado)</option>
        {PLANS.map((p) => (
          <option key={p.key} value={p.key}>
            Plano: {p.name}
          </option>
        ))}
      </select>
      <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 13 }}>
        Visualizar
      </button>
    </form>
  );
}

/** Strip shown on every screen while previewing, with the way out. */
export async function PreviewBanner({ label, role, plan }: { label: string; role: string | null; plan: string | null }) {
  const back = (await headers()).get("x-pathname") ?? "/";
  return (
    <div className="preview-bar">
      <span>
        <strong>Modo visualização</strong> — você está vendo o sistema como: {label}. Nada é gravado neste modo.
      </span>
      <details className="menu-inline">
        <summary className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 13 }}>
          Trocar
        </summary>
        <div className="menu-list" style={{ right: 0, left: "auto", minWidth: 280 }}>
          <PreviewForm role={role} plan={plan} compact />
        </div>
      </details>
      <form action={stopPreview}>
        <input type="hidden" name="back" value={back} />
        <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 13 }}>
          Sair da visualização
        </button>
      </form>
    </div>
  );
}
