"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copiar código Pix" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // older browsers: select a hidden textarea
          const t = document.createElement("textarea");
          t.value = text;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }}
    >
      {copied ? "Copiado!" : label}
    </button>
  );
}
