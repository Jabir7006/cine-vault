import type { MovieBoxSetupReason, SourcesResponse } from "./types";

const setupMessages: Record<MovieBoxSetupReason, string> = {
  missing_signing_key: "Backend request-signing setup is missing.",
  invalid_signing_key: "Backend request-signing setup is invalid.",
  missing_tmdb_token: "The backend TMDB token is missing.",
  missing_media_hosts: "Approved media hosts are not configured.",
  invalid_relay_key: "The configured relay signing key is invalid.",
  invalid_configuration: "Backend configuration is invalid.",
};

const statusMessages: Record<Exclude<SourcesResponse["moviebox"]["status"], "ready" | "blocked_setup">, string> = {
  not_found: "No exact title match was found.",
  ambiguous: "Title matching is ambiguous.",
  unverified: "The stream could not be verified for direct playback.",
  unsupported_adaptive: "This adaptive stream is not supported yet.",
  unsupported_format: "No supported progressive stream is available.",
  unavailable: "No verified direct stream is available.",
};

/** Statuses the same lookup can answer differently: upstream decides per request, not per title. */
const transientStatuses: ReadonlySet<SourcesResponse["moviebox"]["status"]> = new Set([
  "unverified", "unsupported_adaptive", "unsupported_format", "unavailable",
]);

export function movieBoxPresentation(
  state: SourcesResponse["moviebox"] | undefined,
  hasDirect: boolean,
  isPending: boolean,
  hasEmbeds = false,
) {
  // A discovery refetch cannot invalidate the viewer's committed direct source.
  if (hasDirect) return { available: true, retryable: false, optionLabel: "MovieBox", message: "MovieBox: verified direct source available." };
  if (isPending && !state) return { available: false, retryable: false, optionLabel: "MovieBox — checking…", message: "MovieBox: checking for a verified direct source…" };
  if (!state) return {
    available: false, retryable: true, optionLabel: "MovieBox — unavailable",
    message: "MovieBox: direct-source status could not be checked.",
  };
  const reason = state.status === "ready"
    ? statusMessages.unavailable
    : state.status === "blocked_setup"
      ? state.reason ? setupMessages[state.reason] : "Backend setup is incomplete."
      : statusMessages[state.status];
  return {
    // A setup fault and a title that matched nothing are answers, not luck: asking again cannot
    // change either, and offering to try would only teach the viewer the button does nothing.
    available: false, retryable: transientStatuses.has(state.status), optionLabel: "MovieBox — unavailable",
    message: `MovieBox unavailable: ${reason} ${hasEmbeds
      ? "Embed fallback candidates remain available; playback is not guaranteed."
      : "No embed fallback candidates are available."}`,
  };
}
