import { MovieBoxError } from "./errors";

const stages = ["tmdb", "matching", "detail", "resources", "episode", "play_info", "stream", "media_probe", "discovery", "session"] as const;
const codes = [
  "no_target", "invalid_target", "invalid_candidates", "identity_incomplete", "identity_conflict",
  "not_found", "ambiguous", "detail_missing", "detail_mismatch", "episode_evidence_missing",
  "authorization_metadata", "codec_missing", "codec_unsupported", "height_missing", "missing_url",
  "invalid_url", "notice", "format", "dash", "hls", "expired", "no_candidates",
  "invalid_resource", "invalid_range", "blocked_address", "busy", "cancelled", "timeout", "upstream",
  "invalid_response", "too_large", "invalid_container", "range_unsatisfied", "probe_rejected",
  "setup", "path", "request", "network", "http", "unauthorized", "denied", "rate_limit", "redirect",
  "malformed", "size", "session", "unknown",
] as const;
const statuses = ["not_found", "ambiguous", "unverified", "unsupported_adaptive", "unsupported_format", "unavailable"] as const;
export type DiagnosticStage = typeof stages[number];
export type DiagnosticCode = typeof codes[number];
export interface DiscoveryFailure {
  stage: DiagnosticStage;
  code: DiagnosticCode;
  httpStatus?: number;
}
export interface MovieBoxDiagnostic extends DiscoveryFailure {
  status: typeof statuses[number];
}
export type MovieBoxDiagnosticCallback = (event: Readonly<MovieBoxDiagnostic>) => void;

export function knownHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}
/** Project only finite fields, even when an injected adapter supplies extra private data. */
export function projectDiscoveryFailure(value: unknown): DiscoveryFailure | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (!stages.includes(row.stage as DiagnosticStage) || !codes.includes(row.code as DiagnosticCode)) return;
  const httpStatus = knownHttpStatus(row.httpStatus);
  return { stage: row.stage as DiagnosticStage, code: row.code as DiagnosticCode,
    ...(httpStatus === undefined ? {} : { httpStatus }) };
}
export function movieBoxFailure(stage: DiagnosticStage, error: unknown): DiscoveryFailure {
  return projectDiscoveryFailure({ stage, code: error instanceof MovieBoxError ? error.code : "unknown",
    httpStatus: error instanceof MovieBoxError ? error.status : undefined }) ?? { stage, code: "unknown" };
}
/** Optional diagnostics are never allowed to change discovery/playback behavior. */
export function emitMovieBoxDiagnostic(callback: MovieBoxDiagnosticCallback | undefined, event: MovieBoxDiagnostic): void {
  try {
    const failure = projectDiscoveryFailure(event);
    if (failure && statuses.includes(event.status)) callback?.(Object.freeze({ status: event.status, ...failure }));
  } catch { /* Logging is best effort and contains no raw exception details. */ }
}
/** Runtime-only terminal output. Pure modules are silent unless a callback is supplied. */
export const warnMovieBoxDiagnostic: MovieBoxDiagnosticCallback = (event) => {
  emitMovieBoxDiagnostic((safe) => {
    console.warn(`[moviebox] discovery_failed status=${safe.status} stage=${safe.stage} code=${safe.code}${safe.httpStatus === undefined ? "" : ` httpStatus=${safe.httpStatus}`}`);
  }, event);
};
