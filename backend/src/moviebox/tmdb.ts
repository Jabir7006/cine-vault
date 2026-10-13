import type { MediaType } from "../providers/types";

export interface TitleIdentity {
  type: MediaType;
  titles: string[];
  year: number;
}

export function parseTmdbIdentity(value: unknown, type: MediaType): TitleIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const data = value as Record<string, unknown>;
  const date = type === "movie" ? data.release_date : data.first_air_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const year = Number(date.slice(0, 4));
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return;
  if (year < 1888 || year > 2200) return;
  const names = type === "movie" ? [data.title, data.original_title] : [data.name, data.original_name];
  const titles = [...new Set(names.filter((name): name is string =>
    typeof name === "string" && name.trim().length > 0 && name.length <= 256,
  ).map((name) => name.trim()))];
  return titles.length ? { type, titles, year } : undefined;
}

/** Only the TMDB API origin is accepted; no browser-supplied URL or credentials. */
export function createTmdbLookup(options: {
  token: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}) {
  const base = new URL(options.baseUrl ?? "https://api.themoviedb.org/3");
  if (base.origin !== "https://api.themoviedb.org" || base.pathname.replace(/\/$/, "") !== "/3" ||
      base.username || base.password || base.search || base.hash || !options.token.trim()) {
    throw new Error("TMDB setup unavailable");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  return async (type: MediaType, id: string, signal?: AbortSignal): Promise<TitleIdentity | undefined> => {
    if (!/^\d{1,20}$/.test(id) || /^0+$/.test(id)) return;
    const deadline = AbortSignal.timeout(5000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const response = await fetcher(`${base.origin}/3/${type}/${id}?language=en-US`, {
      headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
      redirect: "manual", signal: combined,
    });
    if (!response.ok || response.redirected || !response.body ||
        (response.url && !response.url.startsWith(`${base.origin}/3/`))) {
      await response.body?.cancel();
      return;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    combined.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        if (combined.aborted) throw new Error("TMDB lookup unavailable");
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) throw new Error("TMDB lookup unavailable");
        chunks.push(value);
      }
      if (combined.aborted) throw new Error("TMDB lookup unavailable");
      return parseTmdbIdentity(JSON.parse(Buffer.concat(chunks).toString("utf8")), type);
    } finally {
      combined.removeEventListener("abort", abort);
      await reader.cancel().catch(() => undefined);
    }
  };
}
