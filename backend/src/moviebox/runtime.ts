import { createSourceService } from "../providers";
import { MovieBoxClient } from "./client";
import { MovieBoxMetadata } from "./metadata";
import { createMovieBoxResolver } from "./resolver";
import { createTmdbLookup } from "./tmdb";
import { createMediaRegistry } from "../media/registry";
import { SecureMediaTransport } from "../media/transport";
import { createPlayerLeases } from "../media/player";
import { createTranscoder } from "../media/transcode";
import { createNativePlayer } from "../media/native";
import { resolveRelaySigningKey } from "../media/runtime-key";
import { assessMovieBoxSetup } from "./runtime-status";
import type { MovieBoxRuntimeConfig } from "./runtime-status";
import { warnMovieBoxDiagnostic } from "./diagnostics";

/** Absent/invalid operator setup cannot prevent the embed server from starting. */
export function createRuntimeServices(runtimeConfig: MovieBoxRuntimeConfig) {
  try {
    const reason = assessMovieBoxSetup(runtimeConfig);
    if (reason) return { sources: createSourceService(undefined, reason) };
    const registry = createMediaRegistry({ signingKey: resolveRelaySigningKey(runtimeConfig.relaySignKey), capacity: 4096 });
    const transport = new SecureMediaTransport({ mediaHosts: runtimeConfig.mediaHosts, captionHosts: runtimeConfig.captionHosts });
    const client = new MovieBoxClient({ movieboxSecretHex: runtimeConfig.movieboxSecretHex, maxAttempts: 3, attemptTimeoutMs: 12000 });
    const lookup = createTmdbLookup({ token: runtimeConfig.tmdb.apiKey, baseUrl: runtimeConfig.tmdb.baseUrl });
    const resolver = createMovieBoxResolver({
      lookup, registry, transport, diagnostic: warnMovieBoxDiagnostic,
      metadata: (signal) => new MovieBoxMetadata({
        get: (path) => client.get(path, signal),
        search: (keyword, page) => client.search(keyword, page, signal),
      }),
    });
    return {
      sources: createSourceService(resolver), playback: resolver.playback,
      media: { registry, transport },
      // A lease and the two local programs that consume it are what make a two-hour title playable
      // for longer than one capability's lifetime. Neither program may be named by a request.
      player: {
        leases: createPlayerLeases({ transport }),
        transcoder: createTranscoder({ ffmpegPath: runtimeConfig.ffmpegPath ?? "ffmpeg" }),
        native: createNativePlayer({ candidates: runtimeConfig.nativePlayers }),
      },
    };
  } catch {
    return { sources: createSourceService(undefined, "invalid_configuration") };
  }
}
