import { config } from "../config";
import { createSourceService } from "../providers";
import { MovieBoxClient } from "./client";
import { MovieBoxMetadata } from "./metadata";
import { createMovieBoxResolver } from "./resolver";
import { createTmdbLookup } from "./tmdb";
import { createMediaRegistry } from "../media/registry";
import { SecureMediaTransport } from "../media/transport";

/** Absent/invalid operator setup cannot prevent the embed server from starting. */
export function createRuntimeServices() {
  if (!/^[\da-fA-F]{60}$/.test(config.movieboxSecretHex) ||
      !/^[\da-fA-F]{64}$/.test(config.relaySignKey) ||
      !config.tmdb.apiKey || !config.mediaHosts.length) {
    return { sources: createSourceService() };
  }
  try {
    const registry = createMediaRegistry({ signingKey: config.relaySignKey });
    const transport = new SecureMediaTransport({ mediaHosts: config.mediaHosts, captionHosts: config.captionHosts });
    const client = new MovieBoxClient({ movieboxSecretHex: config.movieboxSecretHex, maxAttempts: 1, attemptTimeoutMs: 5000 });
    const lookup = createTmdbLookup({ token: config.tmdb.apiKey, baseUrl: config.tmdb.baseUrl });
    const resolver = createMovieBoxResolver({
      lookup, registry, transport,
      metadata: (signal) => new MovieBoxMetadata({
        get: (path) => client.get(path, signal),
        search: (keyword, page) => client.search(keyword, page, signal),
      }),
    });
    return { sources: createSourceService(resolver), media: { registry, transport } };
  } catch {
    return { sources: createSourceService() };
  }
}
