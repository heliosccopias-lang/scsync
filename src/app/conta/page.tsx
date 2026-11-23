import { Notice, Shell } from "@/components/Shell";
import { requireOrg } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSudo } from "@/lib/sudo";
import { MODULES, PERMS, ROLES, rolePerms } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";
import { addAccess, confirmSudo, createUser, resetPassword, saveCompany, setSharing, updateMember } from "./actions";
import { PreviewForm } from "@/components/PreviewControls";

const MODEL: Record<string, string> = { services: "Só serviços", products: "Só produtos", both: "Serviços e produtos" };
const STATUS: Record<string, string> = { trial: "Período de teste", active: "Ativa", past_due: "Mensalidade em atraso", suspended: "Suspensa", cancelled: "Cancelada" };
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));
const ENTITY: Record<string, string> = {
  orgs: "Empresa",
  org_members: "Acesso de usuário",
  service_orders: "OS",
  catalog_items: "Item do catálogo",
  settlements: "Recebimento/pagamento",
  receivables: "Conta a receber",
  payables: "Conta a pagar",
  card_statements: "Fatura de cartão",
};
const ACTION: Record<string, string> = { insert: "criou", update: "alterou", delete: "apagou" };

function RolePicker({ prefix = "", role = "attendance", perms }: { prefix?: string; role?: string; perms?: string[] | null }) {
  const active = new Set(perms ?? rolePerms(role));
  return (
    <>
      <select name={`${prefix}role`} defaultValue={role} aria-label="Perfil" style={{ width: 200 }}>
        {ROLES.map((r) => (
          <option key={r.key} value={r.key} title={r.help}>
            {r.label}
          </option>
        ))}
      </select>
      <details style={{ display: "inline-block", marginLeft: 6 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
          permissões (perfil Personalizado)
        </summary>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px", marginTop: 6 }}>
          {PERMS.map((p) => (
            <label key={p.key} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, fontSize: 13 }}>
              <input type="checkbox" name={`${prefix}perm_${p.key}`} defaultChecked={active.has(p.key)} style={{ width: "auto" }} /> {p.label}
            </label>
          ))}
        </div>
      </details>
    </>
  );
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; senha?: string }> }) {
  const { error, ok, senha } = await searchParams;
  const ctx = await requireOrg();
  const sudo = await hasSudo(ctx.user.id);

  if (!sudo) {
    return (
      <Shell>
        <h1>Conta {ctx.account.name}</h1>
        <Notice error={error} ok={ok} />
        <form action={confirmSudo} className="card" style={{ maxWidth: 420 }}>
          <p style={{ marginTop: 0 }}>Esta área controla empresas, módulos e acessos. Confirme sua senha para continuar.</p>
          <div className="field">
            <label htmlFor="pw">Sua senha</label>
            <input id="pw" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn btn-primary">Confirmar</button>
        </form>
      </Shell>
    );
  }

  const admin = supabaseAdmin();
  const { data: orgs } = await admin.from("orgs").select("id, name, cnpj, business_model, modules").eq("account_id", ctx.accountId).order("name");
  const orgIds = (orgs ?? []).map((o) => o.id as string);
  const [{ data: members }, { data: owners }, { data: audit }] = await Promise.all([
    admin.from("org_members").select("org_id, user_id, role, permissions, active").in("org_id", orgIds),
    admin.from("account_members").select("user_id").eq("account_id", ctx.accountId),
    admin.from("audit_log").select("id, org_id, user_id, action, entity, details, created_at").eq("account_id", ctx.accountId).order("created_at", { ascending: false }).limit(60),
  ]);
  const ownerIds = new Set((owners ?? []).map((o) => o.user_id as string));
  const userIds = [...new Set([...(members ?? []).map((m) => m.user_id as string), ...ownerIds, ...(audit ?? []).map((a) => a.user_id as string).filter(Boolean)])];
  const { data: profiles } = userIds.length ? await admin.from("user_profiles").select("user_id, name, email, must_change_password").in("user_id", userIds) : { data: [] };
  const prof = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const orgName = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const people = userIds
    .filter((u) => (members ?? []).some((m) => m.user_id === u) || ownerIds.has(u))
    .map((u) => ({ id: u, name: (prof.get(u)?.name as string) || "", email: (prof.get(u)?.email as string) || "", pending: !!prof.get(u)?.must_change_password, owner: ownerIds.has(u), access: (members ?? []).filter((m) => m.user_id === u) }))
    .sort((a, b) => Number(b.owner) - Number(a.owner) || (a.name || a.email).localeCompare(b.name || b.email, "pt-BR"));
  const nonOwnerCount = people.filter((p) => !p.owner).length;
  const { data: accRow } = await admin.from("accounts").select("share_catalog").eq("id", ctx.accountId).maybeSingle();
  const shared = Boolean(accRow?.share_catalog);

  return (
    <Shell>
      <h1>Conta {ctx.account.name}</h1>
      <Notice error={error} ok={ok} />
      {senha ? (
        <div className="notice notice-ok">
          Senha provisória: <strong style={{ fontFamily: "monospace", fontSize: 18 }}>{senha}</strong> <CopyButton text={senha} label="Copiar senha" />
          <div className="muted" style={{ fontSize: 13 }}>Ela só aparece agora.</div>
        </div>
      ) : null}

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <strong>Assinatura:</strong> {STATUS[ctx.account.status] ?? ctx.account.status}
            {ctx.account.status === "trial" && ctx.account.trial_ends_at ? ` até ${fmtDate(ctx.account.trial_ends_at)}` : ""} · plano {ctx.account.plan}
          </div>
          <a className="btn btn-secondary" href="/conta/assinatura">
            Ver planos e pagamentos
          </a>
          <div className="muted">
            {orgs?.length ?? 0} de {ctx.account.max_companies} empresas · {nonOwnerCount} de {ctx.account.max_users} usuários
          </div>
        </div>
      </section>

      <h2>Empresas (CNPJs)</h2>
      {(orgs ?? []).map((o) => {
        const mods = (o.modules ?? {}) as Record<string, boolean>;
        return (
          <details key={o.id} className="card" style={{ marginBottom: 10 }}>
            <summary style={{ cursor: "pointer" }}>
              <strong>{o.name}</strong> <span className="muted">{o.cnpj ? `· CNPJ ${o.cnpj}` : ""} · {MODEL[o.business_model]}</span>
            </summary>
            <form action={saveCompany} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={o.id} />
              <div className="grid2">
                <div className="field">
                  <label>Nome</label>
                  <input name="name" defaultValue={o.name} required />
                </div>
                <div className="field">
                  <label>CNPJ</label>
                  <input name="cnpj" defaultValue={o.cnpj ?? ""} inputMode="numeric" />
                </div>
                <div className="field">
                  <label>Modelo de negócio</label>
                  <select name="model" defaultValue={o.business_model}>
                    {Object.entries(MODEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <strong>Módulos ligados</strong>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", margin: "8px 0 12px" }}>
                {MODULES.map((m) => (
                  <label key={m.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 400 }}>
                    <input type="checkbox" name={`mod_${m.key}`} defaultChecked={mods[m.key] !== false} style={{ width: "auto", marginTop: 3 }} />
                    <span>
                      {m.label}
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {m.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>Desligar um módulo esconde as telas dele; nada é apagado e religar traz tudo de volta.</p>
              <button className="btn btn-primary">Salvar empresa</button>
            </form>
          </details>
        );
      })}
      <form action={saveCompany} className="card row" style={{ marginBottom: 24 }}>
        <strong>Nova empresa</strong>
        <input name="name" placeholder="Nome da empresa" style={{ width: 220 }} required />
        <input name="cnpj" placeholder="CNPJ" inputMode="numeric" style={{ width: 170 }} />
        <select name="model" defaultValue="both" aria-label="Modelo" style={{ width: 190 }}>
          {Object.entries(MODEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn btn-primary">Criar empresa</button>
      </form>

      <section className="card" style={{ marginBottom: 24 }}>
        <div className="spread">
          <div>
            <strong>Produtos compartilhados entre as empresas</strong>{" "}
            {shared ? <span className="pill pill-paid">Ligado</span> : <span className="pill pill-neutral">Desligado</span>}
            <div className="muted" style={{ fontSize: 13, marginTop: 4, maxWidth: 640 }}>
              Ligado, os produtos (papel, tinta, envelope, agenda, caneta…) ficam iguais em todos os CNPJs da conta: nome, código, preço e situação. O
              estoque continua separado por CNPJ. Clientes nunca são compartilhados. Onde houver diferença, vale o cadastro da empresa aberta agora (
              {ctx.orgName}).
            </div>
          </div>
          <div className="row">
            <form action={setSharing}>
              <input type="hidden" name="on" value="true" />
              <button className="btn btn-primary">{shared ? "Sincronizar agora" : "Ligar compartilhamento"}</button>
            </form>
            {shared ? (
              <form action={setSharing}>
                <input type="hidden" name="on" value="false" />
                <button className="btn btn-secondary">Desligar</button>
              </form>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 24, borderColor: "var(--orange)" }}>
        <strong>👁 Visualizar como cliente</strong>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 10px", maxWidth: 680 }}>
          Depois de configurar módulos, perfis e plano, veja como o sistema fica para um usuário com determinado perfil ou para uma gráfica num
          determinado plano. Menus, telas e botões aparecem exatamente como para essa pessoa. Nada é gravado enquanto estiver visualizando; para sair,
          use o botão na faixa escura do topo.
        </p>
        <PreviewForm />
      </section>

      <h2>Usuários e perfis</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Cada pessoa tem o próprio login. O perfil vale por empresa: a mesma pessoa pode ser Financeiro numa e Consulta noutra.
      </p>
      {people.map((p) => (
        <details key={p.id} className="card" style={{ marginBottom: 10 }}>
          <summary style={{ cursor: "pointer" }}>
            <strong>{p.name || p.email}</strong> <span className="muted">{p.email}</span>
            {p.owner ? <span className="pill pill-open" style={{ marginLeft: 8 }}>Dono</span> : null}
            {p.pending ? <span className="pill pill-partial" style={{ marginLeft: 8 }}>senha provisória</span> : null}
            <span className="muted"> · {p.access.map((a) => `${orgName.get(a.org_id)}: ${ROLE_LABEL[a.role] ?? a.role}${a.active ? "" : " (bloqueado)"}`).join(" · ")}</span>
          </summary>
          {p.owner ? (
            <p className="muted">O Dono tem acesso total a todas as empresas da conta.</p>
          ) : (
            <>
              <table style={{ marginTop: 10 }}>
                <tbody>
                  {p.access.map((a) => (
                    <tr key={a.org_id} style={{ opacity: a.active ? 1 : 0.55 }}>
                      <td style={{ width: 200 }}>{orgName.get(a.org_id)}</td>
                      <td>
                        <form action={updateMember} className="row" style={{ gap: 6 }}>
                          <input type="hidden" name="user_id" value={p.id} />
                          <input type="hidden" name="org_id" value={a.org_id} />
                          <RolePicker role={a.role} perms={a.permissions} />
                          <button className="btn btn-secondary">Salvar</button>
                        </form>
                      </td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        <form action={updateMember} style={{ display: "inline" }}>
                          <input type="hidden" name="user_id" value={p.id} />
                          <input type="hidden" name="org_id" value={a.org_id} />
                          <input type="hidden" name="op" value="toggle" />
                          <input type="hidden" name="active" value={String(a.active)} />
                          <button className="btn btn-secondary">{a.active ? "Bloquear" : "Liberar"}</button>
                        </form>{" "}
                        <form action={updateMember} style={{ display: "inline" }}>
                          <input type="hidden" name="user_id" value={p.id} />
                          <input type="hidden" name="org_id" value={a.org_id} />
                          <input type="hidden" name="op" value="remove" />
                          <button className="btn btn-secondary" style={{ color: "var(--bad)" }}>
                            Remover
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ marginTop: 10 }}>
                {(orgs ?? []).some((o) => !p.access.some((a) => a.org_id === o.id)) ? (
                  <form action={addAccess} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="user_id" value={p.id} />
                    <select name="org_id" aria-label="Empresa" style={{ width: 200 }}>
                      {(orgs ?? [])
                        .filter((o) => !p.access.some((a) => a.org_id === o.id))
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                    <RolePicker />
                    <button className="btn btn-secondary">Dar acesso</button>
                  </form>
                ) : null}
                <form action={resetPassword}>
                  <input type="hidden" name="user_id" value={p.id} />
                  <button className="btn btn-secondary">Gerar senha provisória</button>
                </form>
              </div>
            </>
          )}
        </details>
      ))}

      <form action={createUser} className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Novo usuário</h3>
        <div className="grid2">
          <div className="field">
            <label htmlFor="u_name">Nome</label>
            <input id="u_name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="u_email">E-mail (é o login)</label>
            <input id="u_email" name="email" type="email" required />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <strong>Empresas:</strong>{" "}
          {(orgs ?? []).map((o) => (
            <label key={o.id} style={{ display: "inline-flex", gap: 6, marginRight: 16, fontWeight: 400 }}>
              <input type="checkbox" name="org_id" value={o.id} defaultChecked={o.id === ctx.orgId} style={{ width: "auto" }} /> {o.name}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <strong>Perfil:</strong> <RolePicker />
        </div>
        <ul className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          {ROLES.map((r) => (
            <li key={r.key}>
              <strong>{r.label}:</strong> {r.help}
            </li>
          ))}
        </ul>
        <button className="btn btn-primary">Criar usuário</button>
        <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
          O sistema gera uma senha provisória; no primeiro acesso a pessoa cria a própria.
        </span>
      </form>

      <h2>Histórico de alterações</h2>
      {(audit ?? []).length === 0 ? (
        <div className="card empty">Nada registrado ainda.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Empresa</th>
              <th>O quê</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {(audit ?? []).map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {new Date(a.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td>{a.user_id ? (prof.get(a.user_id)?.name as string) || (prof.get(a.user_id)?.email as string) || "—" : "Sistema"}</td>
                <td>{orgName.get(a.org_id) ?? "—"}</td>
                <td>
                  {ACTION[a.action] ?? a.action} {ENTITY[a.entity] ?? a.entity}
                </td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {Object.entries((a.details ?? {}) as Record<string, unknown>)
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}` : JSON.stringify(v)}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
