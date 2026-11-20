// Checklist questions and answers: shapes and validation shared by the editor and the fill screen.

export type QuestionType = "single" | "multi" | "rating" | "upload";

export type Question = {
  id: string;
  position: number;
  prompt: string;
  type: QuestionType;
  options: string[];
  required: boolean;
  comment_required: "never" | "always" | "some_options";
};

export type AnswerValue = { choice?: string; choices?: string[]; rating?: number; attachment_ids?: string[] };

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Escolha única",
  multi: "Várias escolhas",
  rating: "Nota de 1 a 5",
  upload: "Foto ou arquivo",
};

export function parseOptions(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

export function isAnswered(q: Question, v: AnswerValue | undefined): boolean {
  if (!v) return false;
  switch (q.type) {
    case "single":
      return !!v.choice;
    case "multi":
      return (v.choices ?? []).length > 0;
    case "rating":
      return typeof v.rating === "number" && v.rating >= 1 && v.rating <= 5;
    case "upload":
      return (v.attachment_ids ?? []).length > 0;
  }
}

/** Reads one question's answer from the fill form. Field names: q_<id>, q_<id>_comment. */
export function readAnswer(q: Question, form: FormData): AnswerValue | null {
  const key = `q_${q.id}`;
  if (q.type === "single") {
    const c = String(form.get(key) ?? "");
    return c && q.options.includes(c) ? { choice: c } : null;
  }
  if (q.type === "multi") {
    const cs = form.getAll(key).map(String).filter((c) => q.options.includes(c));
    return cs.length ? { choices: cs } : null;
  }
  if (q.type === "rating") {
    const r = Number(form.get(key));
    return r >= 1 && r <= 5 ? { rating: r } : null;
  }
  return null; // uploads are handled separately
}

export function describeAnswer(q: Question, v: AnswerValue | undefined): string {
  if (!v) return "—";
  if (q.type === "single") return v.choice ?? "—";
  if (q.type === "multi") return (v.choices ?? []).join(", ") || "—";
  if (q.type === "rating") return v.rating ? `${v.rating} de 5` : "—";
  return `${(v.attachment_ids ?? []).length} arquivo(s)`;
}
