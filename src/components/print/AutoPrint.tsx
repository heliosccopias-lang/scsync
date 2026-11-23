"use client";

import { useEffect } from "react";

/** Opens the print dialog once, right after the page shows (used after a counter sale). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}
