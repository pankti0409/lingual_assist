import { useEffect } from "react";

const SITE = "Lingual Assist";

/** Sets a meaningful document title for each route. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : `${SITE} — Your words. Your choice. Your conversation.`;
  }, [title]);
}

const DEVANAGARI = /[ऀ-ॿ]/;

/** `lang` attribute for user text: "hi" when it contains Devanagari, otherwise inherit. */
export function langFor(text: string | null | undefined): "hi" | undefined {
  return text && DEVANAGARI.test(text) ? "hi" : undefined;
}

/** Pause nonessential CSS animation while the tab is hidden (`html.is-hidden *` rules in global.css). */
export function installVisibilityClass() {
  const apply = () => document.documentElement.classList.toggle("is-hidden", document.hidden);
  apply();
  document.addEventListener("visibilitychange", apply);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatPct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(0)}%`;
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
