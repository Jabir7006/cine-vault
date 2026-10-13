import type { MovieBoxSetupReason } from "../providers/types";

export interface MovieBoxRuntimeConfig {
  readonly movieboxSecretHex: string;
  readonly relaySignKey: string;
  readonly mediaHosts: readonly string[];
  readonly captionHosts: readonly string[];
  readonly tmdb: { readonly apiKey: string; readonly baseUrl: string };
}

const setupReasons: ReadonlySet<string> = new Set([
  "missing_signing_key", "invalid_signing_key", "missing_tmdb_token",
  "missing_media_hosts", "invalid_relay_key", "invalid_configuration",
]);

/** Only these fixed, non-sensitive codes may appear in the public response. */
export function isMovieBoxSetupReason(value: unknown): value is MovieBoxSetupReason {
  return typeof value === "string" && setupReasons.has(value);
}

/** Presence/format checks only: no network, credential discovery, or host admission. */
export function assessMovieBoxSetup(config: MovieBoxRuntimeConfig): MovieBoxSetupReason | undefined {
  if (!config.movieboxSecretHex.trim()) return "missing_signing_key";
  if (!/^[\da-fA-F]{60}$/.test(config.movieboxSecretHex)) return "invalid_signing_key";
  if (!config.tmdb.apiKey.trim()) return "missing_tmdb_token";
  if (!config.mediaHosts.length) return "missing_media_hosts";
  // An absent relay key keeps the existing random process-local key behavior.
  if (config.relaySignKey !== "" && !/^[\da-fA-F]{64}$/.test(config.relaySignKey)) return "invalid_relay_key";
  return undefined;
}
