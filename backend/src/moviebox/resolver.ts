import { randomBytes } from "node:crypto";
import type { MovieBoxResolver, MovieBoxResolution } from "../providers";
import type { DirectQuality, DirectSource, MediaType, ResolveParams, Subtitle } from "../providers/types";
import type { MediaRegistry, MediaResource, MediaTransport } from "../media/types";
import { MovieBoxMetadata, classifyStream } from "./metadata";
import type { PrivateStreamMetadata, SubjectDetail } from "./metadata";
import { hasEpisodeEvidence, matchMovieBoxSubject } from "./matching";
import type { TitleIdentity } from "./tmdb";

const opaqueId = () => randomBytes(18).toString("base64url");

/** The resolver never promotes API format labels or signed policies to playback evidence. */
export function createMovieBoxResolver(options: {
  metadata: (signal: AbortSignal) => MovieBoxMetadata;
  lookup: (type: MediaType, id: string, signal?: AbortSignal) => Promise<TitleIdentity | undefined>;
  registry: MediaRegistry;
  transport: MediaTransport;
  now?: () => number;
}): MovieBoxResolver {
  const now = options.now ?? Date.now;
  const mappings = new Map<string, { subject: SubjectDetail; expiresAt: number }>();
  const results = new Map<string, { result: MovieBoxResolution; expiresAt: number }>();
  const flights = new Map<string, Promise<MovieBoxResolution>>();
  const prune = () => {
    for (const cache of [mappings, results]) {
      for (const [key, entry] of cache) if (entry.expiresAt <= now()) cache.delete(key);
      while (cache.size >= 128) cache.delete(cache.keys().next().value!);
    }
  };

  const work = async (type: MediaType, id: string, params: ResolveParams, signal: AbortSignal): Promise<MovieBoxResolution> => {
    const workDeadline = performance.now() + 10000;
    const metadata = options.metadata(signal);
    const mappingKey = `${type}:${id}`;
    let subject = mappings.get(mappingKey)?.subject;
    if (!subject) {
      const target = await options.lookup(type, id, signal);
      if (!target) return { status: "unverified" };
      const matched = await matchMovieBoxSubject(metadata, target);
      if (matched.status !== "matched") return matched;
      subject = matched.subject;
      if (signal.aborted) return { status: "unavailable" };
      prune();
      mappings.set(mappingKey, { subject, expiresAt: now() + 30 * 60 * 1000 });
    }
    const selection = type === "tv" ? { season: params.season ?? 1, episode: params.episode ?? 1 } : undefined;
    const resources: PrivateStreamMetadata[] = [];
    for (let page = 1; page <= 2; page++) {
      if (signal.aborted) return { status: "unavailable" };
      const result = await metadata.resources(subject.subjectId, { page, perPage: 30, selection });
      resources.push(...result.resources);
      if (!result.hasMore) break;
    }
    let episodeVerified = !selection;
    if (selection) {
      const seasons = subject.seasons.length ? subject.seasons : await metadata.seasons(subject.subjectId);
      episodeVerified = hasEpisodeEvidence(selection, seasons, resources);
    }
    if (!episodeVerified) return { status: "unverified" };
    const streams = await metadata.playInfo(subject.subjectId, selection).catch(() => []);
    const candidates = [
      ...resources.filter((resource) => !selection || (resource.se === selection.season && resource.ep === selection.episode)),
      ...streams.filter((resource) => !selection || (resource.se === undefined && resource.ep === undefined) ||
        (resource.se === selection.season && resource.ep === selection.episode)),
    ];
    const registered: string[] = [];
    try {
      const qualities: DirectQuality[] = [];
      const subtitles: Subtitle[] = [];
      const captionUrls = new Set<string>();
      const captionLanguages = new Set<string>();
      const seen = new Set<string>();
      const seenHeights = new Set<number>();
      let expiresAt = now() + 5 * 60 * 1000;
      let adaptive = false;
      let unverified = false;
      for (const candidate of candidates.slice(0, 8)) {
        if (signal.aborted) return { status: "unavailable" };
        const classification = classifyStream(candidate);
        if (classification.status === "unsupported_adaptive") { adaptive = true; continue; }
        if (classification.status === "unsupported_format") continue;
        if (candidate.requiresVerification || !candidate.url || seen.has(candidate.url)) { unverified = true; continue; }
        // Unknown formats/codec metadata are not proof of a browser-compatible MP4.
        if (candidate.format && !["mp4", "video/mp4"].includes(candidate.format.toLowerCase())) { unverified = true; continue; }
        if (!candidate.codec || !/^(?:h\.?264|avc|avc1)(?:[ ._-]|$)/i.test(candidate.codec)) { unverified = true; continue; }
        const height = candidate.height;
        if (!height || seenHeights.has(height)) { unverified = true; continue; }
        const resource: MediaResource = {
          url: candidate.url, kind: "video", headers: candidate.headers,
          height, codec: candidate.codec, resourceId: candidate.resourceId, expiresAt: candidate.expiresAt,
        };
        let probed = false;
        if (qualities.length) {
          if (performance.now() >= workDeadline) break;
          const probeController = new AbortController();
          const probeSignal = AbortSignal.any([signal, probeController.signal]);
          let probeTimer: ReturnType<typeof setTimeout> | undefined;
          const probeTimeout = new Promise<boolean>((resolve) => {
            probeTimer = setTimeout(() => { probeController.abort(); resolve(false); }, Math.min(500, workDeadline - performance.now()));
          });
          try { probed = await Promise.race([options.transport.probe(resource, probeSignal).catch(() => false), probeTimeout]); }
          finally { clearTimeout(probeTimer); probeController.abort(); }
        } else {
          probed = await options.transport.probe(resource, signal);
        }
        if (!probed) { unverified = true; continue; }
        const resourceExpiry = candidate.expiresAt ? Math.min(expiresAt, candidate.expiresAt - 60000) : expiresAt;
        if (resourceExpiry <= now() + 30000) continue;
        expiresAt = resourceExpiry;
        seen.add(candidate.url);
        seenHeights.add(height);
        // Register after probing, and only expose the opaque capability path.
        const token = options.registry.register(resource, expiresAt);
        registered.push(token);
        qualities.push({ id: opaqueId(), label: `${height}p`, height, url: `/media/${token}` });
        if (candidate.resourceId && subtitles.length === 0 && performance.now() < workDeadline) {
          const captionController = new AbortController();
          const captionSignal = AbortSignal.any([signal, captionController.signal]);
          const captionMetadata = options.metadata(captionSignal);
          const captionBudget = Math.min(500, workDeadline - performance.now());
          let captionTimer: ReturnType<typeof setTimeout> | undefined;
          const captionTimeout = new Promise<never>((_resolve, reject) => {
            captionTimer = setTimeout(() => { captionController.abort(); reject(new Error("Caption unavailable")); }, captionBudget);
          });
          try {
            const captions = await Promise.race([captionMetadata.captions(subject.subjectId, candidate.resourceId), captionTimeout]).catch(() => []);
            for (const caption of captions.slice(0, 8)) {
              const format = caption.format?.toLowerCase() ?? new URL(caption.url).pathname.split(".").pop()?.toLowerCase();
              if (caption.requiresVerification || (format !== "srt" && format !== "vtt") ||
                  !caption.lang || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(caption.lang) ||
                  caption.lang.length > 35 || !caption.label || caption.label.length > 120 ||
                  /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/u.test(caption.label) ||
                  captionUrls.has(caption.url) || captionLanguages.has(caption.lang.toLowerCase())) continue;
              const descriptor: MediaResource = {
                kind: "subtitle", url: caption.url, headers: caption.headers, captionFormat: format,
                lang: caption.lang, label: caption.label,
              };
              try {
                await Promise.race([options.transport.caption(descriptor, captionSignal), captionTimeout]);
                if (captionSignal.aborted) break;
                const captionToken = options.registry.register(descriptor, expiresAt);
                registered.push(captionToken);
                captionUrls.add(caption.url);
                captionLanguages.add(caption.lang.toLowerCase());
                subtitles.push({ id: opaqueId(), lang: caption.lang, label: caption.label, url: `/media/${captionToken}` });
              } catch { /* An unavailable caption must not discard a verified video. */ }
            }
          } finally {
            clearTimeout(captionTimer);
            captionController.abort();
          }
        }
      }
      if (signal.aborted) return { status: "unavailable" };
      if (!qualities.length) return { status: adaptive ? "unsupported_adaptive" : unverified ? "unverified" : "unsupported_format" };
      const audioId = opaqueId();
      const source: DirectSource = {
        type: "direct", provider: "moviebox", label: "MovieBox", format: "progressive",
        sessionId: opaqueId(), expiresAt, renewAt: expiresAt - 30000,
        qualities: qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0)), subtitles,
        // Alternate dub subjects are not exposed until their relationship/resources are verified.
        audios: [{ id: audioId, label: "Source audio", lang: "und" }], selectedAudio: audioId,
      };
      registered.length = 0;
      return { status: "ready", source };
    } finally {
      for (const token of registered) options.registry.revoke(token);
    }
  };

  return async (type, id, params, signal) => {
    prune();
    if (signal?.aborted) return { status: "unavailable" };
    const key = `${type}:${id}:${type === "tv" ? `${params.season ?? 1}:${params.episode ?? 1}` : "movie"}`;
    const cached = results.get(key);
    if (cached) {
      const source = cached.result.source;
      const valid = !source || [...source.qualities, ...source.subtitles].every((resource) =>
        options.registry.resolve(resource.url.slice("/media/".length), "GET") !== undefined);
      if (valid) return cached.result;
      results.delete(key);
    }
    let flight = flights.get(key);
    if (!flight) {
      if (flights.size >= 4) return { status: "unavailable" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<MovieBoxResolution>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve({ status: "unavailable" }); }, 12000);
      });
      const running = work(type, id, params, controller.signal).catch((): MovieBoxResolution => ({ status: "unavailable" }));
      const combined = Promise.race([running, timeout]).then((result) => {
        prune();
        results.set(key, { result, expiresAt: result.source ? result.source.renewAt : now() + 15000 });
        return result;
      });
      flight = combined;
      flights.set(key, combined);
      void running.finally(() => { clearTimeout(timer); flights.delete(key); });
    }
    if (!signal) return flight;
    return new Promise<MovieBoxResolution>((resolve) => {
      const abort = () => resolve({ status: "unavailable" });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void flight.then(resolve).finally(() => signal.removeEventListener("abort", abort));
    });
  };
}
