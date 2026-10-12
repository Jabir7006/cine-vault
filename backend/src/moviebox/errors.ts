export type MovieBoxErrorCode =
  | "setup" | "path" | "request" | "network" | "timeout" | "http"
  | "unauthorized" | "denied" | "rate_limit" | "redirect"
  | "malformed" | "size" | "session";

const messages: Record<MovieBoxErrorCode, string> = {
  setup: "MovieBox setup requires MOVIEBOX_SECRET_HEX containing exactly 30 bytes of hexadecimal runtime key material.",
  path: "MovieBox requires a validated internal relative path.",
  request: "MovieBox request options are invalid.",
  network: "MovieBox upstream is unavailable after bounded attempts.",
  timeout: "MovieBox upstream attempt exceeded its deadline.",
  http: "MovieBox upstream returned an unsuccessful status.",
  unauthorized: "MovieBox authentication was rejected.",
  denied: "MovieBox access was denied.",
  rate_limit: "MovieBox upstream rate limit reached; no host failover was attempted.",
  redirect: "MovieBox upstream redirect was rejected.",
  malformed: "MovieBox upstream returned malformed JSON.",
  size: "MovieBox upstream response exceeded the byte limit.",
  session: "MovieBox upstream did not supply a usable visitor session.",
};

/** Never attach upstream bodies, tokens, headers, URLs, keys, or raw causes. */
export class MovieBoxError extends Error {
  readonly code: MovieBoxErrorCode;
  readonly status?: number;
  constructor(code: MovieBoxErrorCode, status?: number) {
    super(messages[code]);
    this.name = "MovieBoxError";
    this.code = code;
    this.status = status;
  }
}
