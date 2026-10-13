import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { MediaRegistry, MediaResource } from "../media/types";
import type { DirectSource, MediaType } from "../providers/types";
import type { EpisodeSelection } from "./metadata";
import type { TitleIdentity } from "./tmdb";

const opaque = () => randomBytes(24).toString("base64url");
const digest = (token: string) => createHash("sha256").update(token).digest();
export interface PlaybackBinding {
  type: MediaType;
  tmdbId: string;
  target: TitleIdentity;
  selection?: EpisodeSelection;
  subjectId: string;
}
export interface PrivateAudio {
  subjectId: string;
  label: string;
  lang: string;
  videos: MediaResource[];
  captions: MediaResource[];
}
export interface PrivateDiscovery {
  binding: PlaybackBinding;
  audios: PrivateAudio[];
  expiresAt: number;
}
export type Continuity = { kind: "none" } | { kind: "same-resource"; qualityId: string };
export interface PreparedReply {
  version: 1;
  kind: "prepared";
  baseRevision: number;
  preparationId: string;
  preparationExpiresAt: number;
  source: DirectSource;
  continuity: Continuity;
}
export interface StateReply {
  version: 1;
  kind: "state";
  source: DirectSource;
  pending: PreparedReply | null;
}
export interface CommittedReply {
  version: 1;
  kind: "committed";
  source: DirectSource;
  pending: null;
}
export type PlaybackReply = PreparedReply | StateReply | CommittedReply;
export type PlaybackErrorCode = "unauthorized" | "invalid_request" | "conflict" | "expired" | "busy" | "rate_limited" | "unavailable";
export class PlaybackError extends Error {
  constructor(readonly code: PlaybackErrorCode, readonly status: 400 | 401 | 409 | 410 | 429 | 503) { super(code); }
}
export interface PrepareInput { version: 1; baseRevision: number; reason: "renew" | "audio"; audioId?: string; qualityId?: string }
export interface CommitInput { version: 1; baseRevision: number; preparationId: string }
interface Generation {
  source: Omit<DirectSource, "controlToken" | "controlExpiresAt">;
  tokens: string[];
  audioSubject: string;
  videos: Map<string, MediaResource>;
}
interface Preparation { id: string; baseRevision: number; expiresAt: number; generation: Generation; continuity: Continuity }
interface Session {
  id: string;
  hash: Buffer;
  binding: PlaybackBinding;
  issuedAt: number;
  absoluteExpiry: number;
  controlExpiry: number;
  audios: Map<string, { subjectId: string; label: string; lang: string }>;
  committed: Generation;
  pending?: Preparation;
  retired: Generation[];
  attempts: number[];
  lastAttempt?: number;
  operation?: AbortController;
}
export interface PlaybackSessions {
  issue(discovery: PrivateDiscovery, signal?: AbortSignal): DirectSource;
  state(sessionId: string, token: string): StateReply;
  prepare(sessionId: string, token: string, input: PrepareInput, signal?: AbortSignal): Promise<PreparedReply>;
  commit(sessionId: string, token: string, input: CommitInput): CommittedReply;
}

/** Equality is representation evidence, not a resource-ID or timeline guess. */
function sameResource(a: MediaResource | undefined, b: MediaResource | undefined): boolean {
  if (!a || !b || !a.representation || !b.representation) return false;
  const headers = (resource: MediaResource) => Object.entries(resource.headers).map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a!.localeCompare(b!));
  return a.url === b.url && a.kind === b.kind && a.height === b.height && a.codec === b.codec &&
    a.resourceId === b.resourceId && JSON.stringify(headers(a)) === JSON.stringify(headers(b)) &&
    a.representation.etag === b.representation.etag && a.representation.length === b.representation.length;
}

export function createPlaybackSessions(options: {
  registry: MediaRegistry;
  refresh(binding: PlaybackBinding, signal: AbortSignal): Promise<PrivateDiscovery | undefined>;
  now?: () => number;
}): PlaybackSessions {
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const revoke = (generation: Generation) => { for (const token of generation.tokens) options.registry.revoke(token); };
  const rollbackPreparation = (session: Session, baseRevision: number) => {
    const pending = session.pending;
    if (pending?.baseRevision === baseRevision) { revoke(pending.generation); session.pending = undefined; }
  };
  const prune = () => {
    for (const [id, session] of sessions) {
      if (session.controlExpiry <= now()) {
        session.operation?.abort();
        // Committed media is independently authorized until its natural registry TTL.
        // Only uncommitted staging is revoked when control ownership expires.
        if (session.pending) revoke(session.pending.generation);
        sessions.delete(id);
        continue;
      }
      if (session.pending && session.pending.expiresAt <= now()) { revoke(session.pending.generation); session.pending = undefined; }
      session.retired = session.retired.filter((generation) => {
        if (generation.source.expiresAt > now()) return true;
        revoke(generation); return false;
      });
    }
  };
  const authenticate = (id: string, token: string): Session => {
    prune();
    const session = sessions.get(id);
    const supplied = digest(typeof token === "string" && token.length <= 128 ? token : "");
    // Always perform a fixed-size comparison, including unknown session IDs.
    const matches = timingSafeEqual(supplied, session?.hash ?? digest(""));
    if (!session || !/^[A-Za-z0-9_-]{43}$/.test(token) || !matches) throw new PlaybackError("unauthorized", 401);
    return session;
  };
  const publicSource = (session: Session, generation: Generation, token: string): DirectSource => ({
    ...generation.source, controlToken: token, controlExpiresAt: Math.min(session.controlExpiry, generation.source.expiresAt + 30000),
    qualities: generation.source.qualities.map((quality) => ({ ...quality })),
    subtitles: generation.source.subtitles.map((caption) => ({ ...caption })),
    audios: generation.source.audios.map((audio) => ({ ...audio })),
  });
  const prepared = (session: Session, pending: Preparation, token: string): PreparedReply => ({
    version: 1, kind: "prepared", baseRevision: pending.baseRevision, preparationId: pending.id,
    preparationExpiresAt: pending.expiresAt, source: publicSource(session, pending.generation, token), continuity: { ...pending.continuity },
  });
  const stage = (session: Session, discovery: PrivateDiscovery, audioId: string, revision: number): Generation => {
    const member = session.audios.get(audioId);
    const audio = discovery.audios.find((audio) => audio.subjectId === member?.subjectId);
    if (!audio || !audio.videos.length || audio.videos.length > 8 || audio.captions.length > 8) throw new PlaybackError("unavailable", 503);
    const resources = [...audio.videos, ...audio.captions];
    let batch: ReturnType<MediaRegistry["registerBatch"]>;
    try { batch = options.registry.registerBatch(resources, Math.min(now() + 300000, discovery.expiresAt)); }
    catch { throw new PlaybackError("unavailable", 503); }
    const rollback = () => batch.tokens.forEach((token) => options.registry.revoke(token));
    if (batch.tokens.length !== resources.length || batch.expiresAt <= now() + 30000 ||
        batch.tokens.some((token) => options.registry.expiresAt(token) !== batch.expiresAt)) {
      rollback(); throw new PlaybackError("unavailable", 503);
    }
    const videos = new Map<string, MediaResource>();
    const owned = batch.tokens.map((token) => options.registry.resolve(token, "GET"));
    if (owned.some((resource) => !resource)) { rollback(); throw new PlaybackError("unavailable", 503); }
    const qualities = audio.videos.map((_resource, index) => {
      const resource = owned[index]!;
      const id = session.committed?.source.qualities.find((quality) => quality.height === resource.height)?.id ?? opaque();
      videos.set(id, structuredClone(resource));
      return { id, label: `${resource.height}p`, height: resource.height, url: `/media/${batch.tokens[index]}` };
    });
    const audios = [...session.audios].filter(([, member]) => discovery.audios.some((audio) => audio.subjectId === member.subjectId))
      .map(([id, member]) => ({ id, label: member.label, lang: member.lang }));
    return {
      tokens: batch.tokens, audioSubject: audio.subjectId, videos,
      source: {
        type: "direct", provider: "moviebox", label: "MovieBox", format: "progressive", sessionId: session.id,
        issuedAt: now(), revision, expiresAt: batch.expiresAt, renewAt: batch.expiresAt - 30000,
        qualities, audios, selectedAudio: audioId,
        subtitles: audio.captions.map((resource, index) => ({ id: opaque(), lang: resource.lang!, label: resource.label!, url: `/media/${batch.tokens[audio.videos.length + index]}` })),
      },
    };
  };
  return {
    issue(discovery, signal) {
      prune();
      if (signal?.aborted || sessions.size >= 32 || !discovery.audios.length) throw new PlaybackError("unavailable", 503);
      const token = randomBytes(32).toString("base64url");
      const issuedAt = now();
      const session: Session = {
        id: opaque(), hash: digest(token), binding: structuredClone(discovery.binding), issuedAt,
        absoluteExpiry: issuedAt + 1800000, controlExpiry: 0, audios: new Map(),
        committed: undefined as unknown as Generation, retired: [], attempts: [],
      };
      for (const audio of discovery.audios.slice(0, 3)) session.audios.set(opaque(), { subjectId: audio.subjectId, label: audio.label, lang: audio.lang });
      session.committed = stage(session, discovery, session.audios.keys().next().value!, 1);
      session.controlExpiry = Math.min(session.absoluteExpiry, session.committed.source.expiresAt + 30000);
      if (signal?.aborted) { revoke(session.committed); throw new PlaybackError("unavailable", 503); }
      sessions.set(session.id, session);
      return publicSource(session, session.committed, token);
    },
    state(id, token) {
      const session = authenticate(id, token);
      return { version: 1, kind: "state", source: publicSource(session, session.committed, token), pending: session.pending ? prepared(session, session.pending, token) : null };
    },
    async prepare(id, token, input, signal) {
      const session = authenticate(id, token);
      if (input.baseRevision !== session.committed.source.revision) throw new PlaybackError("conflict", 409);
      const audioId = input.audioId ?? session.committed.source.selectedAudio;
      if (!session.committed.source.audios.some((audio) => audio.id === audioId) || (input.reason === "audio" && !input.audioId) ||
          (input.reason === "renew" && audioId !== session.committed.source.selectedAudio) ||
          (input.qualityId !== undefined && !session.committed.videos.has(input.qualityId))) throw new PlaybackError("invalid_request", 400);
      if (signal?.aborted) throw new PlaybackError("unavailable", 503);
      if (session.operation || session.pending || session.retired.length >= 2) throw new PlaybackError("busy", 409);
      session.attempts = session.attempts.filter((time) => time > now() - 300000);
      if (session.attempts.length >= 8 || (session.lastAttempt !== undefined && now() - session.lastAttempt < 5000)) throw new PlaybackError("rate_limited", 429);
      session.lastAttempt = now(); session.attempts.push(now());
      const controller = new AbortController(); session.operation = controller;
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const running = (async () => {
        const discovery = await options.refresh(session.binding, combined);
        prune();
        if (combined.aborted || sessions.get(id) !== session || !discovery) throw new PlaybackError("unavailable", 503);
        if (session.committed.source.revision !== input.baseRevision || session.pending || session.retired.length >= 2) throw new PlaybackError("conflict", 409);
        const generation = stage(session, discovery, audioId, input.baseRevision + 1);
        if (combined.aborted || sessions.get(id) !== session) { revoke(generation); throw new PlaybackError("unavailable", 503); }
        const oldId = input.qualityId ?? session.committed.source.qualities[0]!.id;
        const oldVideo = session.committed.videos.get(oldId);
        const newQuality = [...generation.videos].find(([, video]) => sameResource(oldVideo, video));
        const continuity: Continuity = input.reason === "renew" && generation.audioSubject === session.committed.audioSubject && newQuality
          ? { kind: "same-resource", qualityId: newQuality[0] } : { kind: "none" };
        session.pending = { id: opaque(), baseRevision: input.baseRevision, generation, continuity,
          expiresAt: Math.min(generation.source.issuedAt + 60000, session.controlExpiry, generation.source.expiresAt) };
        return prepared(session, session.pending, token);
      })();
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new PlaybackError("unavailable", 503)); }, 12000);
      });
      const cancelled = new Promise<never>((_resolve, reject) => {
        combined.addEventListener("abort", () => reject(new PlaybackError("unavailable", 503)), { once: true });
      });
      // A timeout does not free a slot while a non-cooperative refresh is still running.
      void running.finally(() => { clearTimeout(timer); if (session.operation === controller) session.operation = undefined; }).catch(() => undefined);
      try { return await Promise.race([running, timeout, cancelled]); }
      catch (error) {
        controller.abort();
        rollbackPreparation(session, input.baseRevision);
        throw error instanceof PlaybackError ? error : new PlaybackError("unavailable", 503);
      }
    },
    commit(id, token, input) {
      const session = authenticate(id, token);
      const pending = session.pending;
      if (input.baseRevision !== session.committed.source.revision || !pending || pending.id !== input.preparationId || pending.baseRevision !== input.baseRevision) throw new PlaybackError("conflict", 409);
      if (pending.expiresAt <= now() || pending.generation.source.expiresAt <= now()) throw new PlaybackError("expired", 410);
      if (pending.generation.tokens.some((capability) => options.registry.expiresAt(capability) !== pending.generation.source.expiresAt || !options.registry.resolve(capability, "GET"))) {
        revoke(pending.generation); session.pending = undefined; throw new PlaybackError("unavailable", 503);
      }
      if (session.retired.length >= 2) throw new PlaybackError("busy", 409);
      // Synchronous CAS. Once committed, a disconnected response must never roll it back.
      session.retired.push(session.committed); session.committed = pending.generation; session.pending = undefined;
      session.controlExpiry = Math.min(session.absoluteExpiry, session.committed.source.expiresAt + 30000);
      return { version: 1, kind: "committed", source: publicSource(session, session.committed, token), pending: null };
    },
  };
}
