"use client";

/** Header checkbox: marks or clears every row checkbox (name="ids") of the list. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Marcar todas"
      title="Marcar todas"
      style={{ width: "auto" }}
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => {
          c.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
