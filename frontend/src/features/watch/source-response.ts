import type { DirectAudio, DirectQuality, DirectSource, MovieBoxSetupReason, Source, SourcesResponse, Subtitle } from "./types";

const MAX_SESSION_WINDOW_MS = 10 * 60_000;
const statuses = new Set<SourcesResponse["moviebox"]["status"]>([
  "ready", "blocked_setup", "not_found", "ambiguous", "unverified",
  "unsupported_adaptive", "unsupported_format", "unavailable",
]);

const invalid = (): never => {
  throw new Error("Playback sources are unavailable or malformed. Please refresh or switch provider.");
};

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};

const text = (value: unknown, max = 120): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max ||
      [...value].some((character) => {
        const point = character.codePointAt(0)!;
        return point <= 31 || (point >= 127 && point <= 159) ||
          (point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069);
      })) return invalid();
  return value.trim();
};

const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,127}$/.test(value)) return invalid();
  return value;
};

const language = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 35 ||
      !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) return invalid();
  return value;
};

const timestamp = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 8.64e15) return invalid();
  return value;
};

// Parse before the API layer resolves these paths against its configured backend
// origin. Absolute URLs, queries, fragments and encoded path segments are never
// accepted here; upstream video/subtitle URLs must remain server-only.
const capabilityPath = (value: unknown): string => {
  if (typeof value !== "string" || !/^\/media\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value) ||
      value.length > "/media/".length + 160) return invalid();
  const token = value.slice("/media/".length);
  if (token === "." || token === "..") return invalid();
  return value;
};

const embedUrl = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 4096 || !/^https:\/\//.test(value) ||
      /[\s\\]/u.test(value)) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  const authority = value.slice("https://".length).split(/[/?#]/, 1)[0];
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || !authority || authority.includes("@")) return invalid();
  return value;
};

const list = <T>(value: unknown, max: number, min: number, parse: (item: unknown) => T): T[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max) return invalid();
  // Array.from also visits sparse entries: holes are malformed, not skipped.
  return Array.from(value, parse);
};

const unique = <T>(values: T[], key: (item: T) => string): void => {
  if (new Set(values.map(key)).size !== values.length) invalid();
};

const parseQuality = (value: unknown): DirectQuality => {
  const item = record(value);
  const quality: DirectQuality = { id: id(item.id), label: text(item.label), url: capabilityPath(item.url) };
  if (item.height !== undefined) {
    if (typeof item.height !== "number" || !Number.isSafeInteger(item.height) || item.height < 1 || item.height > 16_384) return invalid();
    quality.height = item.height;
  }
  // Progressive resources are manual choices, never an invented adaptive mode.
  if (quality.label.toLowerCase() === "auto") return invalid();
  return quality;
};

const parseSubtitle = (value: unknown): Subtitle => {
  const item = record(value);
  const subtitle = { id: id(item.id), label: text(item.label), lang: language(item.lang), url: capabilityPath(item.url) };
  if (subtitle.id === "off") return invalid();
  return subtitle;
};

const parseAudio = (value: unknown): DirectAudio => {
  const item = record(value);
  return { id: id(item.id), label: text(item.label), lang: language(item.lang) };
};

const parseDirect = (item: Record<string, unknown>): DirectSource => {
  if (item.provider !== "moviebox" || item.format !== "progressive") return invalid();
  const expiresAt = timestamp(item.expiresAt);
  const renewAt = timestamp(item.renewAt);
  const issuedAt = timestamp(item.issuedAt);
  const controlExpiresAt = timestamp(item.controlExpiresAt);
  // Parsing is deterministic; expired capabilities are rejected by the player.
  if (issuedAt > renewAt || renewAt >= expiresAt || expiresAt - issuedAt > MAX_SESSION_WINDOW_MS ||
      controlExpiresAt <= issuedAt || controlExpiresAt > expiresAt + 30_000) return invalid();
  if (typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) || item.revision < 1) return invalid();
  if (typeof item.controlToken !== "string" || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(item.controlToken)) return invalid();
  const qualities = list(item.qualities, 8, 1, parseQuality);
  const subtitles = list(item.subtitles, 8, 0, parseSubtitle);
  const audios = list(item.audios, 8, 1, parseAudio);
  unique(qualities, (quality) => quality.id);
  unique(qualities, (quality) => quality.url);
  unique(qualities, (quality) => quality.label.toLowerCase());
  unique(subtitles, (subtitle) => subtitle.id);
  unique(subtitles, (subtitle) => subtitle.url);
  unique(audios, (audio) => audio.id);
  const selectedAudio = id(item.selectedAudio);
  if (!audios.some((audio) => audio.id === selectedAudio)) return invalid();
  return {
    type: "direct", provider: "moviebox", format: "progressive", label: text(item.label),
    sessionId: id(item.sessionId), issuedAt, revision: item.revision, controlToken: item.controlToken,
    controlExpiresAt, expiresAt, renewAt, qualities, subtitles, audios, selectedAudio,
  };
};

const parseSource = (value: unknown): Source => {
  const item = record(value);
  if (item.type === "direct") return parseDirect(item);
  if (item.type !== "embed") return invalid();
  if (typeof item.provider !== "string" || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,63}$/.test(item.provider) || item.provider === "moviebox") return invalid();
  return { type: "embed", provider: item.provider, label: text(item.label), embedUrl: embedUrl(item.embedUrl) };
};

/** Validate unknown JSON and project only the public v2 playback contract. */
export const parseDirectSource = (value: unknown): DirectSource => {
  const item = record(value);
  if (item.type !== "direct") return invalid();
  return parseDirect(item);
};

export const parseSourcesResponse = (value: unknown): SourcesResponse => {
  const response = record(value);
  const moviebox = record(response.moviebox);
  if (response.version !== 2 || typeof moviebox.status !== "string" ||
      !statuses.has(moviebox.status as SourcesResponse["moviebox"]["status"])) return invalid();
  const reasons = new Set<MovieBoxSetupReason>([
    "missing_signing_key", "invalid_signing_key", "missing_tmdb_token",
    "missing_media_hosts", "invalid_relay_key", "invalid_configuration",
  ]);
  if (Object.hasOwn(moviebox, "reason") && (moviebox.status !== "blocked_setup" ||
      typeof moviebox.reason !== "string" || !reasons.has(moviebox.reason as MovieBoxSetupReason))) return invalid();
  const sources = list(response.sources, 16, 0, parseSource);
  unique(sources, (source) => source.provider);
  if (sources.some((source) => source.type === "direct") !== (moviebox.status === "ready")) return invalid();
  return {
    version: 2, sources,
    moviebox: {
      status: moviebox.status as SourcesResponse["moviebox"]["status"],
      ...(Object.hasOwn(moviebox, "reason") ? { reason: moviebox.reason as MovieBoxSetupReason } : {}),
    },
  };
};
