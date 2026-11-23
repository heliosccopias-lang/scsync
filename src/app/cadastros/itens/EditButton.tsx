"use client";

/** Opens (or closes) the item's edit row — the <details id="edit-…"> under its name — and focuses the name field. */
export function EditButton({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      style={{ padding: "3px 8px", fontSize: 12 }}
      onClick={() => {
        const d = document.getElementById(`edit-${id}`) as HTMLDetailsElement | null;
        if (!d) return;
        d.open = !d.open;
        if (d.open) d.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      }}
    >
      ✎ Editar
    </button>
  );
}
