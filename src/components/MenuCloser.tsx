"use client";

import { useEffect } from "react";

/**
 * Closes the dropdowns and floating panels built with <details> — the top-bar menus, the
 * "Imprimir ▾" style menus (details.menu-inline) and the small forms like "Pagar…" (details.popover) —
 * when the user clicks outside, opens another one, picks an item, clicks a [data-close] button or
 * presses Esc. Renders nothing.
 */
export function MenuCloser() {
  useEffect(() => {
    const menus = () => Array.from(document.querySelectorAll<HTMLDetailsElement>(".topbar details.menu[open], details.menu-inline[open], details.popover[open], details.inline-edit[open]"));
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Mobile: picking a screen closes the menu panel.
      if (target?.closest(".topnav a")) {
        const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
        if (t) t.checked = false;
      }
      for (const m of menus()) {
        // A button elsewhere that opens this panel (data-opens="<details id>") counts as inside.
        const inside = !!target && (m.contains(target) || (!!m.id && !!target.closest(`[data-opens="${m.id}"]`)));
        // Picking a menu item, the ✕ button or a form's submit button (Registrar pagamento) closes it too.
        const pickedItem = inside && !!target?.closest(".menu-list a, [data-close], details.popover button:not([type=button]), details.inline-edit button:not([type=button])");
        if (!inside || pickedItem) m.open = false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") for (const m of menus()) m.open = false;
    };
    // Floating forms (details.popover): pinned to the viewport next to their button, so a table
    // (overflow: hidden) or the bar below never covers them; open upwards when there is no room below.
    const place = (d: HTMLDetailsElement) => {
      const panel = d.querySelector<HTMLElement>(":scope > .popover-panel");
      const btn = d.querySelector<HTMLElement>(":scope > summary");
      if (!panel || !btn) return;
      const r = btn.getBoundingClientRect();
      panel.style.position = "fixed";
      panel.style.zIndex = "60";
      panel.style.margin = "0";
      panel.style.maxHeight = `${window.innerHeight - 16}px`;
      panel.style.overflowY = "auto";
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      const below = r.bottom + 4;
      const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 4);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
    };
    const placeAll = () => document.querySelectorAll<HTMLDetailsElement>("details.popover[open]").forEach(place);
    const onToggle = (e: Event) => {
      const d = e.target as HTMLElement;
      if (d instanceof HTMLDetailsElement && d.classList.contains("popover") && d.open) place(d);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("toggle", onToggle, true);
    window.addEventListener("scroll", placeAll, true);
    window.addEventListener("resize", placeAll);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("toggle", onToggle, true);
      window.removeEventListener("scroll", placeAll, true);
      window.removeEventListener("resize", placeAll);
    };
  }, []);
  return null;
}
