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
    const menus = () => Array.from(document.querySelectorAll<HTMLDetailsElement>(".topbar details.menu[open], details.menu-inline[open], details.popover[open]"));
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Mobile: picking a screen closes the menu panel.
      if (target?.closest(".topnav a")) {
        const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
        if (t) t.checked = false;
      }
      for (const m of menus()) {
        const inside = !!target && m.contains(target);
        // Picking a menu item, the ✕ button or a form's submit button (Registrar pagamento) closes it too.
        const pickedItem = inside && !!target?.closest(".menu-list a, [data-close], details.popover button:not([type=button])");
        if (!inside || pickedItem) m.open = false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") for (const m of menus()) m.open = false;
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
