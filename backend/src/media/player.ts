import { randomBytes } from "node:crypto";
import { dashDirectory } from "./dash.ts";
import { TransportError } from "./transport.ts";
import type { MediaResource, MediaTransport } from "./types.ts";

/**
 * A player lease: one stable URL over an authorization that is periodically re-negotiated.
 *
 * A title runs for hours, and the capability a session hands a browser is deliberately short-lived.
 * Between the two sits this lease. `/player/<id>/index.mpd` never changes, while the signed manifest
 * and its cookie behind it are replaced on a timer — so a native player (mpv) and the H.264
 * transcode can both read the same lease for a whole film without the UI re-negotiating anything.
 *
 * The lease is deliberately not a capability in the media registry: what authorizes it is its
 * unguessable id plus the loopback-only rule the route applies, not a signed token. It therefore
 * holds upstream credentials directly and revokes nothing when it ends.
 */
export const PLAYER_PREFIX = "/player/";
const LEASE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export type PlayerErrorCode = "unknown_lease" | "invalid_resource" | "invalid_range" | "stale" | "unavailable";
export class PlayerError extends Error {
  constructor(readonly code: PlayerErrorCode, readonly status: 400 | 404 | 503) {
    super(`Player lease ${code.replaceAll("_", " ")}`);
    this.name = "PlayerError";
  }
}

/** Re-negotiates the stream behind a lease. Called whenever the current authorization is due. */
export type PlayerAuthorizer = (signal: AbortSignal) => Promise<MediaResource | undefined>;

export interface PlayerLease {
  id: string;
  /** Path prefix every URL of this lease lives under, always with a trailing slash. */
  base: string;
  expiresAt: number;
}

export interface PlayerLeases {
  /** One lease per key: asking twice for the same playback session returns the same lease. */
  open(key: string, authorize: PlayerAuthorizer, signal?: AbortSignal): Promise<PlayerLease>;
  /** The lease already open for a key, without re-authorizing anything. */
  find(key: string): PlayerLease | undefined;
  manifest(id: string, method: "GET" | "HEAD", signal?: AbortSignal): Promise<Response>;
  segment(id: string, name: string, range: string | undefined, signal?: AbortSignal): Promise<Response>;
  /** The heights the live generation advertises, in its own order: a position is a stream index. */
  ladder(id: string): readonly number[];
  /** This relay's own URL for the lease's manifest, as a path. */
  manifestPath(id: string): string;
  /** Resolves once no re-negotiation is in flight, so a test need not observe a timer. */
  settle(id: string): Promise<void>;
  close(id: string): void;
}

export interface PlayerLeaseOptions {
  transport: MediaTransport;
  /**
   * How many leases may be live at once. A new lease gives up the longest-idle one that has been
   * untouched past `idleEvictMs`; a lease something is still reading is never given up, and a full
   * set of leases in use refuses the new one rather than stranding a player that is playing.
   */
  capacity?: number;
  /**
   * How long a lease may go untouched before a new one may take its place.
   *
   * A player reads through its lease every few seconds, so anything past this is a page that was
   * left or a film that was closed — while a lease only a moment old is evidence of nothing.
   */
  idleEvictMs?: number;
  /** How long a lease lives, independent of how many times it re-negotiates. */
  leaseMs?: number;
  /** Past this age the authorization is re-negotiated in the background. */
  rotationMs?: number;
  /** A request only waits for a re-negotiation past this age, and fails if one still cannot be made. */
  hardMs?: number;
  /** Failed re-negotiations are retried no more often than this. */
  retryMs?: number;
  /** A single re-negotiation that takes longer than this is abandoned. */
  renewMs?: number;
  now?: () => number;
}

interface Generation {
  resource: MediaResource;
  heights: readonly number[];
  servedAt: number;
}
interface Lease {
  id: string;
  key: string;
  authorize: PlayerAuthorizer;
  generation: Generation;
  expiresAt: number;
  renewing?: Promise<void>;
  lastAttempt: number;
  /** When a request last read through this lease, which is what tells a playing lease from an idle one. */
  usedAt: number;
}

const bounded = (value: number | undefined, fallback: number, max: number, min: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid player lease configuration");
  return value;
};

/** A re-negotiated ladder must describe the same encode; a different one would strand the player. */
function sameLadder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((height, index) => height === b[index]);
}

export function createPlayerLeases(options: PlayerLeaseOptions): PlayerLeases {
  const transport = options.transport;
  if (!transport.relayManifest || !transport.relaySegment || !transport.readManifest) {
    throw new Error("Invalid player lease configuration");
  }
  const now = options.now ?? Date.now;
  const capacity = bounded(options.capacity, 8, 64, 1);
  const leaseMs = bounded(options.leaseMs, 6 * 60 * 60_000, 12 * 60 * 60_000, 60_000);
  const idleEvictMs = bounded(options.idleEvictMs, 2 * 60_000, 6 * 60 * 60_000, 1_000);
  const rotationMs = bounded(options.rotationMs, 6 * 60_000, 60 * 60_000, 30_000);
  const hardMs = bounded(options.hardMs, 9 * 60_000, 2 * 60 * 60_000, rotationMs);
  const retryMs = bounded(options.retryMs, 30_000, 15 * 60_000, 1_000);
  const renewMs = bounded(options.renewMs, 15_000, 60_000, 1_000);
  const leases = new Map<string, Lease>();
  const byKey = new Map<string, string>();

  const expired = (lease: Lease): boolean => lease.expiresAt <= now();
  const prune = () => {
    for (const [id, lease] of leases) {
      if (!expired(lease)) continue;
      leases.delete(id);
      if (byKey.get(lease.key) === id) byKey.delete(lease.key);
    }
  };
  const lookup = (id: string): Lease => {
    prune();
    if (typeof id !== "string" || !LEASE_PATTERN.test(id)) throw new PlayerError("unknown_lease", 404);
    const lease = leases.get(id);
    if (!lease) throw new PlayerError("unknown_lease", 404);
    return lease;
  };

  /**
   * Give up the longest-idle lease so a page that was left does not hold the slot a new viewer needs.
   *
   * Every playback session asks for its own lease, so without this a handful of abandoned tabs would
   * fill the set and refuse a viewer who is actually watching. A lease being read is not a candidate
   * at all, which is what keeps this from stranding a film that is playing.
   */
  const evictIdle = (): boolean => {
    let oldest: Lease | undefined;
    for (const lease of leases.values()) {
      if (now() - lease.usedAt < idleEvictMs) continue;
      if (oldest === undefined || lease.usedAt < oldest.usedAt) oldest = lease;
    }
    if (oldest === undefined) return false;
    leases.delete(oldest.id);
    if (byKey.get(oldest.key) === oldest.id) byKey.delete(oldest.key);
    return true;
  };

  /**
   * Adopt a resource as the live generation, but only after reading it.
   *
   * Reading is what registers the signed directory in the transport, and an unregistered directory
   * cannot serve a segment at all — so a manifest that cannot be read is never swapped in, and the
   * lease keeps serving the authorization it already proved.
   */
  const adopt = async (resource: MediaResource | undefined, signal: AbortSignal): Promise<Generation | undefined> => {
    if (!resource || resource.kind !== "manifest" || dashDirectory(resource.url) === undefined) return undefined;
    const manifest = await transport.readManifest!(resource, signal);
    // A manifest with no ladder is not a stream this relay can offer, and an empty read is a refusal.
    if (signal.aborted || !manifest.heights.length) return undefined;
    return { resource: { ...resource, heights: [...manifest.heights] }, heights: [...manifest.heights], servedAt: now() };
  };

  const renew = (lease: Lease): Promise<void> => {
    if (lease.renewing) return lease.renewing;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), renewMs);
    const running = (async () => {
      // A re-negotiation must not be cancelled by whichever request happened to trigger it.
      const generation = await adopt(await lease.authorize(controller.signal), controller.signal);
      if (controller.signal.aborted || !generation) return;
      if (!sameLadder(lease.generation.heights, generation.heights)) return;
      lease.generation = generation;
    })().catch(() => undefined).finally(() => {
      clearTimeout(timer);
      if (lease.renewing === running) lease.renewing = undefined;
    });
    lease.renewing = running;
    return running;
  };

  /**
   * The generation to serve, re-negotiating in the background rather than on the player's clock.
   *
   * A lease that is merely due is refreshed without the caller waiting, so a segment never pays for
   * a discovery round-trip. Only an authorization that has outlived even its grace period blocks,
   * and one that cannot then be replaced is reported rather than served half-dead.
   */
  const current = async (lease: Lease): Promise<Generation> => {
    const age = () => now() - lease.generation.servedAt;
    if (age() >= rotationMs && now() - lease.lastAttempt >= retryMs) {
      lease.lastAttempt = now();
      void renew(lease);
    }
    if (age() >= hardMs) {
      await renew(lease);
      if (age() >= hardMs) throw new PlayerError("stale", 503);
    }
    return lease.generation;
  };

  const relay = async <T>(id: string, run: (generation: Generation) => Promise<T>): Promise<T> => {
    const lease = lookup(id);
    lease.usedAt = now();
    const generation = await current(lease);
    try { return await run(generation); }
    catch (error) {
      // A revoked upstream authorization surfaces as a fetch refusal, which is the same condition a
      // stale lease is in: try once more through a fresh authorization before giving up.
      if (!(error instanceof TransportError) || ageOf(lease) < rotationMs) throw error;
      await renew(lease);
      if (lease.generation.servedAt === generation.servedAt) throw error;
      return run(lease.generation);
    }
  };
  const ageOf = (lease: Lease) => now() - lease.generation.servedAt;

  return {
    async open(key, authorize, signal) {
      prune();
      if (typeof key !== "string" || !key || key.length > 128) throw new PlayerError("invalid_resource", 400);
      const existing = byKey.get(key);
      const held = existing === undefined ? undefined : leases.get(existing);
      if (held) return { id: held.id, base: `${PLAYER_PREFIX}${held.id}/`, expiresAt: held.expiresAt };
      if (leases.size >= capacity && !evictIdle()) throw new PlayerError("unavailable", 503);
      if (signal?.aborted) throw new PlayerError("unavailable", 503);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), renewMs);
      let generation: Generation | undefined;
      try {
        generation = await adopt(await authorize(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal), controller.signal);
      } finally { clearTimeout(timer); }
      if (!generation || signal?.aborted) throw new PlayerError("unavailable", 503);
      const id = randomBytes(24).toString("base64url");
      const lease: Lease = { id, key, authorize, generation, expiresAt: now() + leaseMs, lastAttempt: 0, usedAt: now() };
      leases.set(id, lease);
      byKey.set(key, id);
      return { id, base: `${PLAYER_PREFIX}${id}/`, expiresAt: lease.expiresAt };
    },
    manifest(id, method, signal) {
      return relay(id, (generation) => transport.relayManifest!(generation.resource, `${PLAYER_PREFIX}${id}/`, method, signal));
    },
    segment(id, name, range, signal) {
      return relay(id, (generation) => transport.relaySegment!(generation.resource, name, range, signal));
    },
    // Reading a lease is what marks it in use: both of these are asked for by a stream that is about
    // to be transcoded, before a single segment has been requested.
    ladder(id) { const lease = lookup(id); lease.usedAt = now(); return lease.generation.heights; },
    manifestPath(id) { const lease = lookup(id); lease.usedAt = now(); return `${PLAYER_PREFIX}${id}/index.mpd`; },
    find(key) {
      prune();
      const id = byKey.get(key);
      const lease = id === undefined ? undefined : leases.get(id);
      return lease === undefined ? undefined : { id: lease.id, base: `${PLAYER_PREFIX}${lease.id}/`, expiresAt: lease.expiresAt };
    },
    async settle(id) {
      const lease = leases.get(id);
      if (lease?.renewing) await lease.renewing;
    },
    close(id) {
      const lease = leases.get(id);
      if (!lease) return;
      leases.delete(id);
      if (byKey.get(lease.key) === id) byKey.delete(lease.key);
    },
  };
}
