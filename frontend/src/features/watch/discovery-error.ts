import { isAxiosError, isCancel } from "axios";

// Backend MovieBox discovery is bounded at 12s; allow response/transport overhead.
export const SOURCES_TIMEOUT_MS = 15_000;
export type DiscoveryFailure = "timeout" | "network" | "http" | "malformed" | "cancelled" | "request";
const messages: Record<DiscoveryFailure, string> = {
  timeout: "Source discovery timed out. The backend did not respond within 15 seconds.",
  network: "Source discovery could not reach the backend. Check the connection or backend address.",
  http: "Source discovery failed: the backend returned an HTTP error.",
  malformed: "Source discovery failed: the backend response was invalid or incompatible.",
  cancelled: "Source discovery was cancelled.",
  request: "Source discovery failed before a usable backend response was received.",
};

export class SourcesDiscoveryError extends Error {
  readonly kind: DiscoveryFailure;
  constructor(kind: DiscoveryFailure) {
    super(messages[kind]);
    this.name = "SourcesDiscoveryError";
    this.kind = kind;
  }
}

/** Never display raw Axios/backend/parser messages, URLs, tokens, or response bodies. */
export function discoveryFailure(error: unknown): SourcesDiscoveryError {
  if (error instanceof SourcesDiscoveryError) return error;
  if (isCancel(error)) return new SourcesDiscoveryError("cancelled");
  if (isAxiosError(error)) {
    if (error.code === "ERR_CANCELED") return new SourcesDiscoveryError("cancelled");
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return new SourcesDiscoveryError("timeout");
    if (error.response) return new SourcesDiscoveryError("http");
    if (error.code === "ERR_NETWORK" || error.request) return new SourcesDiscoveryError("network");
  }
  return new SourcesDiscoveryError("request");
}

export function discoveryFailureMessage(error: unknown, hasEmbeds: boolean): string {
  return `${discoveryFailure(error).message} ${hasEmbeds
    ? "Embed providers can still be selected; playback is not guaranteed."
    : "No embed fallback candidates are available."}`;
}
