import type { PlayerLease } from "./types";

/**
 * The player lease contract.
 *
 * The lease is what makes a two-and-a-half-hour film playable from an authorization that lasts
 * minutes: the URL below never changes while the authorization behind it is replaced. It is served
 * to this host only, so the origin it reports is always a loopback spelling — anything else could
 * not answer, and is refused here rather than handed to a video element that would fail obscurely.
 */
const invalid = (): never => { throw new Error("The player lease response was invalid."); };

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};

const positive = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 8.64e15) return invalid();
  return value;
};

const loopbackOrigin = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 2048) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.protocol !== "http:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return invalid();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return invalid();
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return invalid();
  return url.origin;
};

const ladder = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return invalid();
  const rungs = Array.from(value, (height) => {
    if (typeof height !== "number" || !Number.isSafeInteger(height) || height < 144 || height > 8_192) return invalid();
    return height;
  });
  if (new Set(rungs).size !== rungs.length) return invalid();
  return rungs;
};

/** Only the lease the backend itself mints: an id, and the directory that id is served from. */
const LEASE_BASE = /^\/player\/[A-Za-z0-9_-]{32}\/$/;

export const parsePlayerLease = (value: unknown): PlayerLease => {
  const item = record(value);
  if (item.version !== 1 || item.kind !== "player") return invalid();
  if (typeof item.base !== "string" || !LEASE_BASE.test(item.base)) return invalid();
  if (typeof item.encoder !== "boolean") return invalid();
  if (item.native !== null && (typeof item.native !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(item.native))) return invalid();
  return {
    base: item.base,
    origin: loopbackOrigin(item.origin),
    expiresAt: positive(item.expiresAt),
    ladder: ladder(item.ladder),
    encoder: item.encoder,
    native: item.native,
  };
};

/** What a native launch reports back: which program was actually started. */
export const parseNativeLaunch = (value: unknown): string => {
  const item = record(value);
  if (item.version !== 1 || item.kind !== "launched" || typeof item.player !== "string" ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(item.player)) return invalid();
  return item.player;
};

/**
 * The transcoded stream a browser element can read, at one rung and one start second.
 *
 * Nothing here is a capability: the lease URL is stable and the rung and start second are ordinary
 * query values, which is what lets the same URL be re-requested after a seek.
 */
export const streamUrl = (lease: PlayerLease, height: number, from: number): string | undefined => {
  if (!lease.encoder || !lease.ladder.includes(height)) return undefined;
  const start = Math.max(0, Math.floor(from));
  return `${lease.origin}${lease.base}stream.mp4?h=${height}${start > 0 ? `&t=${start}` : ""}`;
};
