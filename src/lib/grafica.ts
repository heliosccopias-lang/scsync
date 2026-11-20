/** Print-shop job specs on a service order. */

export const COLOR_OPTIONS = ["4x0", "4x1", "4x4", "1x0", "1x1"] as const;

export const FINISHING_OPTIONS = [
  ["corte", "Corte"],
  ["laminacao", "Laminação"],
  ["refile", "Refile"],
  ["encadernacao", "Encadernação"],
] as const;

export type PrintSpec = {
  print_format: string | null;
  print_paper: string | null;
  print_colors: string | null;
  finishing: string[];
  art_approved: boolean;
  art_approved_at: string | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the spec fields from a form. `get` returns "" for missing keys. */
export function readPrintSpec(get: (k: string) => string, today: string): PrintSpec {
  const t = (k: string, max: number) => get(k).trim().slice(0, max) || null;
  const finishing: string[] = FINISHING_OPTIONS.filter(([key]) => get(`fin_${key}`) !== "").map(([, label]) => label);
  const other = get("fin_other").trim().slice(0, 60);
  if (other) finishing.push(other);
  const approved = get("art_approved") !== "";
  const day = get("art_approved_at").trim();
  return {
    print_format: t("print_format", 120),
    print_paper: t("print_paper", 120),
    print_colors: t("print_colors", 40),
    finishing,
    art_approved: approved,
    art_approved_at: approved ? (ISO_DAY.test(day) ? day : today) : null,
  };
}

/** Splits stored finishing into the fixed checkboxes and the free "outro" text. */
export function splitFinishing(finishing: string[] | null | undefined): { checked: Set<string>; other: string } {
  const labels = new Map<string, string>(FINISHING_OPTIONS.map(([key, label]) => [label, key]));
  const checked = new Set<string>();
  const rest: string[] = [];
  for (const f of finishing ?? []) {
    const key = labels.get(f);
    if (key) checked.add(key);
    else rest.push(f);
  }
  return { checked, other: rest.join(", ") };
}
