import type { MovieBoxResolver, MovieBoxResolution } from "../providers";
import type { MediaType, MovieBoxStatus, ResolveParams } from "../providers/types";
import { isMediaRepresentation, mediaProbeFailureCodes } from "../media/types";
import { TransportError } from "../media/transport";
import { emitMovieBoxDiagnostic, movieBoxFailure, projectDiscoveryFailure } from "./diagnostics";
import type { DiagnosticStage, DiscoveryFailure, MovieBoxDiagnosticCallback } from "./diagnostics";
import type { MediaProbeEvidence, MediaResource, MediaRegistry, MediaTransport } from "../media/types";
import type { PlayerAuthorizer } from "../media/player";
import { streamManifestUrl } from "../media/dash";
import { MovieBoxMetadata, classifyStream } from "./metadata";
import { MovieBoxError } from "./errors";
import type { DubMetadata, PrivateStreamMetadata, SubjectDetail } from "./metadata";
import { hasEpisodeEvidence, identityMatches, matchMovieBoxSubject } from "./matching";
import type { TitleIdentity } from "./tmdb";
import { createPlaybackSessions } from "./playback-sessions";
import type { PlaybackBinding, PlaybackSessions, PrivateAudio, PrivateDiscovery } from "./playback-sessions";

type DiscoveryResult = { status: MovieBoxStatus; discovery?: PrivateDiscovery };
interface WorkContext {
  signal: AbortSignal; deadline: number; tasks: Set<Promise<unknown>>;
  stage: DiagnosticStage; failure?: DiscoveryFailure;
  /** Every play-info answer offered only the downgrade advertisement, with no authorization on it. */
  advertisementOnly?: true;
}
const safeLabel = (value: string | undefined): value is string => typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/u.test(value);
const safeLanguage = (value: string | undefined): value is string => typeof value === "string" && value.length <= 35 && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value);

/** Private descriptor singleflight; every public response owns fresh mutable capabilities. */
export function createMovieBoxResolver(options: {
  metadata: (signal: AbortSignal) => MovieBoxMetadata;
  lookup: (type: MediaType, id: string, signal?: AbortSignal) => Promise<TitleIdentity | undefined>;
  registry: MediaRegistry;
  transport: MediaTransport;
  now?: () => number;
  diagnostic?: MovieBoxDiagnosticCallback;
  /**
   * How many times one play-info listing is asked for while it returns only the downgrade
   * advertisement. Optional; the default is the number of independently measured attempts that
   * makes an unserved title rare without giving a genuinely unavailable one an unbounded cost.
   */
  playInfoAttempts?: number;
}): MovieBoxResolver & { playback: PlaybackSessions } {
  const now = options.now ?? Date.now;
  const playInfoAttempts = options.playInfoAttempts ?? 4;
  if (!Number.isSafeInteger(playInfoAttempts) || playInfoAttempts < 1 || playInfoAttempts > 8) {
    throw new Error("Invalid moviebox resolver configuration");
  }
  const mappings = new Map<string, { binding: PlaybackBinding; subject: SubjectDetail; expiresAt: number }>();
  const results = new Map<string, { result: DiscoveryResult; expiresAt: number }>();
  const flights = new Map<string, { result: Promise<DiscoveryResult>; settled: boolean }>();
  const prune = () => {
    for (const cache of [mappings, results]) {
      for (const [key, entry] of cache) if (entry.expiresAt <= now()) cache.delete(key);
      while (cache.size > 128) cache.delete(cache.keys().next().value!);
    }
  };
  const track = <T>(context: WorkContext, task: Promise<T>): Promise<T> => {
    context.tasks.add(task);
    void task.finally(() => context.tasks.delete(task)).catch(() => undefined);
    return task;
  };
  const budget = async <T>(context: WorkContext, ms: number, callback: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const remaining = Math.min(ms, context.deadline - performance.now());
    if (remaining <= 0 || context.signal.aborted) return undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(undefined); }, remaining);
    });
    try { return await Promise.race([track(context, callback(signal)).catch(() => undefined), timeout]); }
    finally { clearTimeout(timer); controller.abort(); }
  };
  const loadAudio = async (binding: PlaybackBinding, subject: SubjectDetail, context: WorkContext, label: string, lang: string, optional = false): Promise<{ audio?: PrivateAudio; status: MovieBoxStatus }> => {
    const metadata = options.metadata(context.signal);
    const resources: PrivateStreamMetadata[] = [];
    let resourceFailure: DiscoveryFailure | undefined;
    context.stage = "resources";
    for (let page = 1; page <= 2; page++) {
      if (context.signal.aborted) return { status: "unavailable" };
      try {
        // perPage is capped by the API at the value the reference client uses: a larger page is
        // rejected outright, which would silently leave play-info's notice clip as the only stream.
        const result = await track(context, metadata.resources(subject.subjectId, { page, perPage: 20, selection: binding.selection }));
        resources.push(...result.resources);
        if (!result.hasMore) break;
      } catch (error) {
        if (!(error instanceof MovieBoxError) || error.code !== "http" || error.status !== 400) throw error;
        // Stop this listing; play-info still needs its own episode and media evidence.
        resourceFailure = movieBoxFailure("resources", error);
        break;
      }
    }
    let episodeVerified = true;
    if (binding.selection) {
      context.stage = "episode";
      const seasons = subject.seasons.length ? subject.seasons : await track(context, metadata.seasons(subject.subjectId));
      episodeVerified = hasEpisodeEvidence(binding.selection, seasons, resources);
      if (!episodeVerified && !resourceFailure) {
        context.failure = { stage: "episode", code: "episode_evidence_missing" }; return { status: "unverified" };
      }
    }
    context.stage = "play_info";
    let playInfoFailure: DiscoveryFailure | undefined;
    const readPlayInfo = (): Promise<PrivateStreamMetadata[]> =>
      track(context, metadata.playInfo(subject.subjectId, binding.selection)).catch((error) => {
        playInfoFailure = movieBoxFailure("play_info", error); return [];
      });
    /**
     * The downgrade advertisement on its own, with no authorization to the title behind it.
     *
     * The API answers the same request either with this row or with the same row carrying the
     * authorization that names the signed manifest. Only the version without it cannot play, and
     * nothing about the request predicts which one comes back — measured over repeated identical
     * requests, roughly one in three carried the authorization. Asking again is therefore the whole
     * remedy; a listing that offers anything else is taken as it is.
     */
    const isUnserved = (rows: readonly PrivateStreamMetadata[]): boolean =>
      rows.length > 0 && rows.every((row) => {
        const classification = classifyStream(row);
        return classification.status === "unsupported_format" && classification.reason === "notice";
      }) && !rows.some((row) => streamManifestUrl(row) !== undefined);
    let streams = await readPlayInfo();
    for (let attempt = 1; attempt < playInfoAttempts && isUnserved(streams) && !context.signal.aborted &&
      performance.now() < context.deadline; attempt++) {
      streams = await readPlayInfo();
    }
    if (isUnserved(streams)) context.advertisementOnly = true;
    const selection = binding.selection;
    if (selection && !episodeVerified && !hasEpisodeEvidence(selection, [], streams)) {
      context.failure = playInfoFailure ?? { stage: "episode", code: "episode_evidence_missing" };
      return { status: "unverified" };
    }
    const candidates = [
      ...resources.filter((resource) => !selection || resource.se === selection.season && resource.ep === selection.episode),
      ...streams.filter((resource) => !selection || resource.se === undefined && resource.ep === undefined || resource.se === selection.season && resource.ep === selection.episode),
    ];
    const videos: MediaResource[] = [];
    const captions: MediaResource[] = [];
    const seen = new Set<string>(); const heights = new Set<number>();
    let adaptive = false; let unverified = false;
    let adaptiveFailure: DiscoveryFailure | undefined;
    let probeFailure: DiscoveryFailure | undefined;
    let streamFailure: DiscoveryFailure | undefined;
    let formatFailure: DiscoveryFailure | undefined;
    const streamPriority = ["codec_missing", "codec_unsupported", "height_missing", "format", "missing_url", "unknown"] as const;
    /**
     * The real content behind a downgrade row.
     *
     * When the API decides not to serve a title it points every row at a notice clip, so the row's own
     * URL is worthless — but its authorization still names the signed manifest that carries the title,
     * and that manifest is verified here before it is offered. One descriptor covers the whole stream:
     * the manifest holds the video ladder and the audio together, so it joins the qualities as a single
     * adaptive entry rather than one entry per rendition.
     */
    const loadManifest = async (): Promise<MediaResource | undefined> => {
      const candidatesWithAuthorization = candidates.slice(0, 8).flatMap((candidate) => {
        const url = streamManifestUrl(candidate);
        return url === undefined ? [] : [{ candidate, url }];
      });
      const attempted = new Set<string>();
      for (const { candidate, url } of candidatesWithAuthorization) {
        if (context.signal.aborted) return undefined;
        if (attempted.has(url) || seen.has(url)) continue;
        attempted.add(url);
        const headers: Record<string, string> = { ...candidate.headers };
        const cookie = candidate.signCookie ?? candidate.cookie;
        if (cookie !== undefined) headers.cookie = cookie;
        const resource: MediaResource = { url, kind: "manifest", headers, expiresAt: candidate.expiresAt };
        if (!options.transport.readManifest) continue;
        context.stage = "media_probe";
        const manifest = await budget(context, 8000, (signal) => options.transport.readManifest!(resource, signal));
        if (manifest === undefined || !manifest.heights.length) {
          // Authorized but unusable: reported as a media probe, never as an unplayable format.
          probeFailure ??= { stage: "media_probe", code: "probe_rejected" };
          unverified = true;
          continue;
        }
        resource.heights = [...manifest.heights];
        // Sorting and quality identity key on one height; the ladder itself is carried alongside.
        resource.height = Math.max(...manifest.heights);
        seen.add(url);
        return resource;
      }
      return undefined;
    };
    // Status precedence is unchanged. Prefer attempted probes to skipped streams,
    // concrete probe evidence to generic rejection, then first observed within a category.
    context.stage = "stream";
    for (const candidate of candidates.slice(0, 8)) {
      if (context.signal.aborted) return { status: "unavailable" };
      const classification = classifyStream(candidate);
      if (classification.status === "unsupported_adaptive") {
        adaptive = true; adaptiveFailure ??= { stage: "stream", code: classification.reason }; continue;
      }
      if (classification.status === "unsupported_format") {
        formatFailure ??= { stage: "stream", code: classification.reason }; continue;
      }
      const code = !candidate.url ? "missing_url" :
        seen.has(candidate.url) ? "unknown" : candidate.format && !["mp4", "video/mp4"].includes(candidate.format.toLowerCase()) ? "format" :
        !candidate.codec ? "codec_missing" : !/^(?:h\.?264|avc|avc1|hev(?:c|1)|hvc|hevc)(?:[ ._-]|$)/i.test(candidate.codec) ? "codec_unsupported" :
        !candidate.height ? "height_missing" : heights.has(candidate.height) ? "unknown" : undefined;
      if (code) {
        unverified = true;
        if (!streamFailure || streamPriority.findIndex((entry) => entry === code) < streamPriority.findIndex((entry) => entry === streamFailure!.code)) {
          streamFailure = { stage: "stream", code };
        }
        continue;
      }
      if (candidate.expiresAt !== undefined && candidate.expiresAt - 60000 <= now() + 30000) {
        formatFailure ??= { stage: "stream", code: "expired" }; continue;
      }
      // Attach authorization credentials (signCookie/policy/cookie) as request headers
      // so the transport probe can verify the CDN-backed stream end-to-end.
      const headers: Record<string, string> = { ...candidate.headers };
      if (candidate.signCookie !== undefined) headers.cookie = candidate.signCookie;
      if (candidate.cookie !== undefined && candidate.signCookie === undefined) headers.cookie = candidate.cookie;
      const resource: MediaResource = {
        url: candidate.url!, kind: "video", headers, height: candidate.height,
        codec: candidate.codec, resourceId: candidate.resourceId, expiresAt: candidate.expiresAt,
      };
      context.stage = "media_probe";
      const probe = async (signal: AbortSignal): Promise<MediaProbeEvidence> => {
        try {
          return await (options.transport.probeEvidence
            ? options.transport.probeEvidence(resource, signal)
            : options.transport.probe(resource, signal).then((playable) => ({ playable, representation: undefined })));
        } catch (error) {
          context.failure = projectDiscoveryFailure({ stage: "media_probe",
            code: error instanceof TransportError && mediaProbeFailureCodes.includes(error.code) ? error.code : "unknown" });
          throw error;
        }
      };
      const evidence = videos.length || optional
        ? await budget(context, 500, probe)
        : await track(context, probe(context.signal));
      if (!evidence?.playable || context.signal.aborted) {
        unverified = true;
        const failure = evidence?.failure;
        const rejected: DiscoveryFailure = failure && mediaProbeFailureCodes.includes(failure.code)
          ? projectDiscoveryFailure({ stage: "media_probe", code: failure.code, httpStatus: failure.httpStatus }) ?? { stage: "media_probe", code: "probe_rejected" }
          : { stage: "media_probe", code: "probe_rejected" };
        if (!probeFailure || ["unknown", "probe_rejected"].includes(probeFailure.code) && !["unknown", "probe_rejected"].includes(rejected.code)) {
          probeFailure = rejected;
        }
        continue;
      }
      // Only typed strong-validator evidence may bind relay representations.
      if (isMediaRepresentation(evidence.representation)) {
        resource.representation = { ...evidence.representation };
      }
      seen.add(candidate.url!); heights.add(candidate.height!); videos.push(resource);
    }
    // A verified manifest is offered alongside any progressive file, never instead of it: a browser
    // cannot decode the ladder's HEVC, while a native player would rather have the whole stream.
    const manifest = await loadManifest();
    if (manifest) videos.push(manifest);
    if (!videos.length) {
      context.failure = adaptive ? adaptiveFailure : unverified ? probeFailure ?? streamFailure :
        formatFailure ?? playInfoFailure ?? resourceFailure ?? { stage: "stream", code: "no_candidates" };
      return { status: adaptive ? "unsupported_adaptive" : unverified ? "unverified" : "unsupported_format" };
    }
    videos.sort((a, b) => b.height! - a.height!);
    const captionVideo = videos.find((video) => video.resourceId);
    if (captionVideo?.resourceId) {
      await budget(context, 500, async (signal) => {
        const metadata = options.metadata(signal);
        const listed = await track(context, metadata.captions(subject.subjectId, captionVideo.resourceId!));
        const urls = new Set<string>(); const languages = new Set<string>();
        for (const caption of listed.slice(0, 8)) {
          if (signal.aborted) break;
          const format = caption.format?.toLowerCase() ?? new URL(caption.url).pathname.split(".").pop()?.toLowerCase();
          if (caption.requiresVerification || caption.resourceId !== undefined && caption.resourceId !== captionVideo.resourceId ||
              format !== "srt" && format !== "vtt" || !safeLanguage(caption.lang) || !safeLabel(caption.label) ||
              urls.has(caption.url) || languages.has(caption.lang.toLowerCase()) ||
              caption.expiresAt !== undefined && caption.expiresAt - 60000 <= now() + 30000) continue;
          const resource: MediaResource = { kind: "subtitle", url: caption.url, headers: { ...caption.headers },
            lang: caption.lang, label: caption.label, captionFormat: format, expiresAt: caption.expiresAt, resourceId: caption.resourceId };
          try {
            await track(context, options.transport.caption(resource, signal));
            if (signal.aborted) break;
            captions.push(resource); urls.add(caption.url); languages.add(caption.lang.toLowerCase());
          } catch { /* Optional captions never discard verified video. */ }
        }
      });
    }
    return { status: "ready", audio: { subjectId: subject.subjectId, label, lang, videos, captions } };
  };
  const relationshipMatches = (dub: DubMetadata, target: TitleIdentity) => identityMatches(dub, target);
  /** Full discovery for one already-identified subject; "ready" still requires verified media. */
  const completeDiscovery = async (type: MediaType, id: string, params: ResolveParams, context: WorkContext,
    target: TitleIdentity, subject: SubjectDetail, bound?: PlaybackBinding): Promise<DiscoveryResult> => {
    const binding: PlaybackBinding = { type, tmdbId: id, target: structuredClone(target), subjectId: subject.subjectId,
      selection: type === "tv" ? { season: params.season ?? 1, episode: params.episode ?? 1 } : undefined };
    const canonical = await loadAudio(binding, subject, context, "Source audio", "und");
    if (!canonical.audio) return { status: canonical.status };
    const audios = [canonical.audio];
    const optionalDeadline = Math.min(context.deadline, performance.now() + 2000);
    const grouped = new Map<string, DubMetadata[]>();
    for (const dub of subject.dubs) { const rows = grouped.get(dub.subjectId) ?? []; rows.push(dub); grouped.set(dub.subjectId, rows); }
    let attempted = 0;
    for (const [subjectId, rows] of grouped) {
      if (subjectId === subject.subjectId) continue;
      const dub = rows[0]!;
      if (rows.some((row) => JSON.stringify(row) !== JSON.stringify(dub)) || !relationshipMatches(dub, target) ||
          !safeLanguage(dub.lang) || !safeLabel(dub.label)) continue;
      if (attempted++ >= 2 || performance.now() >= optionalDeadline || context.signal.aborted) break;
      const audio = await budget(context, Math.min(1000, optionalDeadline - performance.now()), async (signal) => {
        const alternateContext: WorkContext = { ...context, signal, deadline: Math.min(optionalDeadline, performance.now() + 1000) };
        const detail = await track(context, options.metadata(signal).detail(subjectId));
        if (!detail || detail.subjectId !== subjectId || !identityMatches(detail, target)) return undefined;
        // The alternate's requested TV episode is proven independently inside loadAudio.
        const verified = await loadAudio(binding, detail, alternateContext, dub.label!, dub.lang!, true);
        return verified.audio;
      });
      if (audio && !context.signal.aborted) audios.push(audio);
    }
    if (context.signal.aborted) return { status: "unavailable" };
    const deadlines = audios.flatMap((audio) => [...audio.videos, ...audio.captions]).flatMap((resource) => resource.expiresAt === undefined ? [] : [resource.expiresAt - 60000]);
    const expiresAt = Math.min(now() + 300000, ...deadlines);
    // Only a subject that produced verified media becomes the refresh binding.
    if (!bound) {
      mappings.set(`${type}:${id}`, { binding, subject: structuredClone(subject), expiresAt: now() + 1800000 }); prune();
    }
    return { status: "ready", discovery: { binding, audios, expiresAt } };
  };
  const discover = async (type: MediaType, id: string, params: ResolveParams, context: WorkContext, bound?: PlaybackBinding): Promise<DiscoveryResult> => {
    const metadata = options.metadata(context.signal);
    const mappingKey = `${type}:${id}`;
    const entry = !bound ? mappings.get(mappingKey) : undefined;
    let target = bound?.target ?? entry?.binding.target;
    let subjects: SubjectDetail[];
    if (bound) {
      context.stage = "detail";
      const subject = await track(context, metadata.detail(bound.subjectId));
      if (!subject || subject.subjectId !== bound.subjectId || !identityMatches(subject, bound.target)) {
        context.failure = { stage: "detail", code: !subject ? "detail_missing" : "detail_mismatch" }; return { status: "unverified" };
      }
      subjects = [subject];
    } else if (entry) {
      subjects = [entry.subject];
    } else {
      context.stage = "tmdb";
      target = await track(context, options.lookup(type, id, context.signal));
      if (!target) { context.failure = { stage: "tmdb", code: "no_target" }; return { status: "unverified" }; }
      context.stage = "matching";
      const matched = await track(context, matchMovieBoxSubject(metadata, target, (failure) => { context.failure = failure; }));
      if (matched.status !== "matched") return matched;
      // Duplicate uploads agree on every search-visible field, so each is verified in turn.
      subjects = [matched.subject, ...matched.alternates];
    }
    if (!target || !subjects.length || context.signal.aborted) return { status: "unavailable" };
    let result: DiscoveryResult = { status: "unavailable" };
    let firstFailure: DiscoveryFailure | undefined;
    for (const subject of subjects) {
      if (context.signal.aborted) break;
      context.failure = undefined;
      result = await completeDiscovery(type, id, params, context, target, subject, bound);
      if (result.status === "ready") return result;
      firstFailure ??= context.failure;
    }
    if (context.signal.aborted) return { status: "unavailable" };
    context.failure ??= firstFailure;
    return result;
  };
  const privateWork = (type: MediaType, id: string, params: ResolveParams, bound?: PlaybackBinding): Promise<DiscoveryResult> => {
    prune();
    const key = `${type}:${id}:${type === "tv" ? `${params.season ?? 1}:${params.episode ?? 1}` : "movie"}:${bound ? `refresh:${bound.subjectId}` : "discovery"}`;
    const cached = !bound ? results.get(key) : undefined;
    if (cached) return Promise.resolve(cached.result);
    const existing = flights.get(key);
    if (existing) return existing.settled ? Promise.resolve({ status: "unavailable" }) : existing.result;
    if (flights.size >= 4) {
      emitMovieBoxDiagnostic(options.diagnostic, { status: "unavailable", stage: "discovery", code: "busy" });
      return Promise.resolve({ status: "unavailable" });
    }
    const controller = new AbortController();
    const context: WorkContext = { signal: controller.signal, deadline: performance.now() + 12000, tasks: new Set(), stage: "discovery" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DiscoveryResult>((resolve) => { timer = setTimeout(() => {
      context.failure = { stage: "discovery", code: "timeout" }; controller.abort(); resolve({ status: "unavailable" });
    }, 12000); });
    const running = discover(type, id, params, context, bound).catch((error): DiscoveryResult => {
      context.failure ??= movieBoxFailure(context.stage, error); return { status: "unavailable" };
    });
    const result = Promise.race([running, timeout]).then((result) => {
      if (result.status !== "ready" && result.status !== "blocked_setup") {
        emitMovieBoxDiagnostic(options.diagnostic, { status: result.status, ...context.failure ?? { stage: context.stage, code: "unknown" } });
      }
      // A refusal the advertisement caused is the one refusal a retry can reverse, and retrying is
      // exactly what the viewer is offered — so it is not remembered, or the retry would be answered
      // with the identical refusal for a quarter of a minute. Every other refusal is cached: one
      // failing lookup is then neither repeated upstream nor logged once per caller.
      const reversible = result.status === "unsupported_format" && context.advertisementOnly === true;
      if (!bound && !controller.signal.aborted && !reversible) {
        results.set(key, { result: structuredClone(result), expiresAt: Math.min(now() + 15000, result.discovery ? result.discovery.expiresAt - 30000 : Infinity) }); prune();
      }
      return result;
    });
    const slot = { result, settled: false };
    flights.set(key, slot);
    void result.then(() => { slot.settled = true; });
    // Retain all admission slots until even aborted/non-cooperative optional subwork settles.
    void running.finally(async () => {
      clearTimeout(timer);
      while (context.tasks.size) await Promise.allSettled([...context.tasks]);
      if (flights.get(key) === slot) flights.delete(key);
    }).catch(() => undefined);
    return result;
  };
  const playback = createPlaybackSessions({ registry: options.registry, now,
    refresh: async (binding, signal) => {
      const result = await awaitCaller(privateWork(binding.type, binding.tmdbId, binding.selection ?? {}, binding), signal);
      return result.discovery;
    },
    // A player lease outlives any single capability, so it re-authorizes through the same verified
    // refresh path a renewal uses and can never be pointed at a subject that stopped matching.
    authorizer: (binding, audioSubject): PlayerAuthorizer => async (signal) => {
      const result = await awaitCaller(privateWork(binding.type, binding.tmdbId, binding.selection ?? {}, binding), signal);
      if (signal.aborted) return undefined;
      const audio = result.discovery?.audios.find((entry) => entry.subjectId === audioSubject) ?? result.discovery?.audios[0];
      return audio?.videos.find((resource) => resource.kind === "manifest");
    },
  });
  const resolve: MovieBoxResolver = async (type, id, params, signal): Promise<MovieBoxResolution> => {
    if (signal?.aborted) return { status: "unavailable" };
    const result = await awaitCaller(privateWork(type, id, params), signal);
    if (!result.discovery || signal?.aborted) return { status: result.status };
    try { return { status: "ready", source: playback.issue(result.discovery, signal) }; }
    catch {
      emitMovieBoxDiagnostic(options.diagnostic, { status: "unavailable", stage: "session", code: "unknown" });
      return { status: "unavailable" };
    }
  };
  return Object.assign(resolve, { playback });
}

/** Caller cancellation cannot cancel shared private discovery or issue a public session. */
function awaitCaller(work: Promise<DiscoveryResult>, signal?: AbortSignal): Promise<DiscoveryResult> {
  if (!signal) return work;
  if (signal.aborted) return Promise.resolve({ status: "unavailable" });
  return new Promise((resolve) => {
    const abort = () => resolve({ status: "unavailable" });
    signal.addEventListener("abort", abort, { once: true });
    void work.then(resolve).finally(() => signal.removeEventListener("abort", abort));
  });
}
