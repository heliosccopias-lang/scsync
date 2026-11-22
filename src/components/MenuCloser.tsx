"use client";

import { useEffect } from "react";

/**
 * Closes the top-bar dropdowns (<details className="menu">) when the user clicks outside,
 * opens another one, picks an item, or presses Esc. Renders nothing.
 */
export function MenuCloser() {
  useEffect(() => {
    const menus = () => Array.from(document.querySelectorAll<HTMLDetailsElement>(".topbar details.menu[open]"));
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Mobile: picking a screen closes the menu panel.
      if (target?.closest(".topnav a")) {
        const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
        if (t) t.checked = false;
      }
      for (const m of menus()) {
        const inside = !!target && m.contains(target);
        const pickedItem = inside && !!target?.closest(".menu-list a");
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
