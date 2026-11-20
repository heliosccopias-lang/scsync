"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX_BYTES = 5 * 1024 * 1024;

function safeName(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "arquivo"
  );
}

export type UploadedFile = { path: string; name: string; size: number };

/**
 * Sends files straight from the browser to the private Storage bucket (the server's request limit is too small
 * for phone photos), then hands the paths to a server action that records them.
 */
export function Uploader({
  orgId,
  folder,
  register,
  extra,
  maxFiles = 10,
  label = "Anexar",
  accept = "image/*,application/pdf",
  capture,
}: {
  orgId: string;
  folder: string; // e.g. service_order/<id>
  register: (files: UploadedFile[], extra: Record<string, string>) => Promise<{ error?: string }>;
  extra?: Record<string, string>;
  maxFiles?: number;
  label?: string;
  accept?: string;
  capture?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    const files = Array.from(input.current?.files ?? []);
    if (!files.length) return setMsg("Escolha um ou mais arquivos.");
    if (files.length > maxFiles) return setMsg(`No máximo ${maxFiles} arquivos.`);
    const big = files.find((f) => f.size > MAX_BYTES);
    if (big) return setMsg(`"${big.name}" passa de 5 MB.`);
    setBusy(true);
    setMsg(null);
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const done: UploadedFile[] = [];
    for (const f of files) {
      const path = `${orgId}/${folder}/${crypto.randomUUID()}-${safeName(f.name)}`;
      const { error } = await sb.storage.from("attachments").upload(path, f, { contentType: f.type || "application/octet-stream" });
      if (error) {
        setBusy(false);
        return setMsg(`Falha ao enviar "${f.name}".`);
      }
      done.push({ path, name: f.name, size: f.size });
    }
    const res = await register(done, extra ?? {});
    setBusy(false);
    if (res.error) return setMsg(res.error);
    if (input.current) input.current.value = "";
    setMsg(`${done.length} arquivo(s) enviado(s).`);
    router.refresh();
  }

  return (
    <div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input ref={input} type="file" multiple accept={accept} {...(capture ? { capture: "environment" as const } : {})} disabled={busy} />
        <button type="button" className="btn btn-secondary" onClick={send} disabled={busy}>
          {busy ? "Enviando..." : label}
        </button>
      </div>
      {msg ? (
        <div className="muted" role="status" style={{ fontSize: 13, marginTop: 4 }}>
          {msg}
        </div>
      ) : null}
    </div>
  );
}
