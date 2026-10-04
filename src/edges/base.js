/** Prefisso per GitHub Pages (es. /peak_prompt_2026/) o `/` in locale. */
export const BASE = import.meta.env.BASE_URL || '/';

/** Unisce BASE a un path assoluto o relativo (`assets/...`). */
export function withBase(url) {
  if (url == null || url === '') return url;
  const s = String(url);
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  return BASE + s.replace(/^\//, '');
}
