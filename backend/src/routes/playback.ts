import { Hono } from "hono";
import { PlaybackError } from "../moviebox/playback-sessions";
import { NativePlayerError } from "../media/native";
import { PlayerError } from "../media/player";
import type { CommitInput, PlaybackSessions, PrepareInput } from "../moviebox/playback-sessions";
import type { NativePlayer } from "../media/native";
import type { PlayerLeases } from "../media/player";
import type { Transcoder } from "../media/transcode";

const invalid = () => new PlaybackError("invalid_request", 400);
const opaque = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1000000;
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") ?? "")) throw invalid();
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 2048)) throw invalid();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => undefined); reject(invalid()); }, 3000);
  });
  const abort = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (request.signal.aborted) throw invalid();
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { void reader.cancel().catch(() => undefined); throw invalid(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
    return parsed as Record<string, unknown>;
  } catch { throw invalid(); }
  finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", abort);
    try { reader.releaseLock(); } catch { /* A cancelled non-cooperative read still has bounded response lifetime. */ }
  }
}
export function parsePrepare(input: Record<string, unknown>): PrepareInput {
  if (Object.keys(input).some((key) => !["version", "baseRevision", "reason", "audioId", "qualityId"].includes(key)) ||
      input.version !== 1 || !revision(input.baseRevision) || (input.reason !== "renew" && input.reason !== "audio") ||
      Object.hasOwn(input, "audioId") && !opaque(input.audioId) || Object.hasOwn(input, "qualityId") && !opaque(input.qualityId) ||
      input.reason === "audio" && !opaque(input.audioId)) throw invalid();
  return input as unknown as PrepareInput;
}
export function parseCommit(input: Record<string, unknown>): CommitInput {
  if (Object.keys(input).some((key) => !["version", "baseRevision", "preparationId"].includes(key)) ||
      input.version !== 1 || !revision(input.baseRevision) || !opaque(input.preparationId)) throw invalid();
  return input as unknown as CommitInput;
}
export function createPlaybackRoute(
  service?: PlaybackSessions,
  player?: { leases: PlayerLeases; transcoder: Transcoder; native: NativePlayer },
) {
  const route = new Hono();
  route.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store"); c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  route.onError((error, c) => {
    c.header("Cache-Control", "no-store"); c.header("Referrer-Policy", "no-referrer");
    if (error instanceof NativePlayerError) return c.json({ version: 1, kind: "error", code: error.code }, error.status);
    if (error instanceof PlayerError) return c.json({ version: 1, kind: "error", code: error.code }, error.status);
    const safe = error instanceof PlaybackError ? error : new PlaybackError("unavailable", 503);
    return c.json({ version: 1, kind: "error", code: safe.code }, safe.status);
  });
  const requireService = (id: string, token: string | undefined) => {
    if (!opaque(id) || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PlaybackError("unauthorized", 401);
    if (!service) throw new PlaybackError("unavailable", 503);
    // Reject missing/wrong/cross-session auth before reading attacker-controlled bodies.
    service.state(id, token);
    return { service, token };
  };
  route.get("/:sessionId", (c) => {
    const id = c.req.param("sessionId");
    const auth = requireService(id, c.req.header("x-playback-control"));
    return c.json(auth.service.state(id, auth.token));
  });
  route.post("/:sessionId/prepare", async (c) => {
    const id = c.req.param("sessionId");
    const auth = requireService(id, c.req.header("x-playback-control"));
    const input = parsePrepare(await body(c.req.raw));
    return c.json(await auth.service.prepare(id, auth.token, input, c.req.raw.signal));
  });
  route.post("/:sessionId/commit", async (c) => {
    const id = c.req.param("sessionId");
    const auth = requireService(id, c.req.header("x-playback-control"));
    const input = parseCommit(await body(c.req.raw));
    if (c.req.raw.signal.aborted) throw new PlaybackError("unavailable", 503);
    return c.json(auth.service.commit(id, auth.token, input));
  });
  /**
   * Open the long-lived lease this session's title plays through.
   *
   * A capability lasts minutes and a film does not, so neither the browser's transcode nor a native
   * player can be pointed at one. The lease keeps the session's own verified binding, re-authorizes
   * through it on a timer, and is reached by machines on this host only — the routes that serve it
   * live under `/player/`, guarded by the peer address rather than by a token.
   */
  route.post("/:sessionId/player", async (c) => {
    const id = c.req.param("sessionId");
    const auth = requireService(id, c.req.header("x-playback-control"));
    if (!player) throw new PlaybackError("unavailable", 503);
    const lease = await player.leases.open(id, auth.service.player(id, auth.token), c.req.raw.signal);
    const origin = new URL(c.req.url).origin;
    return c.json({
      version: 1, kind: "player", base: lease.base, expiresAt: lease.expiresAt,
      ladder: [...player.leases.ladder(lease.id)],
      // What this host can actually do, so the UI offers only the paths that exist here.
      encoder: player.transcoder.ffmpeg !== undefined,
      native: player.native.available === undefined ? null : player.native.available.split("/").pop() ?? null,
      origin,
    });
  });
  /** Hand the lease to a player on this machine, which reads the signed manifest as it is. */
  route.post("/:sessionId/player/native", (c) => {
    const id = c.req.param("sessionId");
    const auth = requireService(id, c.req.header("x-playback-control"));
    if (!player) throw new PlaybackError("unavailable", 503);
    const lease = player.leases.find(id);
    if (!lease) throw new PlaybackError("conflict", 409);
    const title = c.req.query("title");
    return c.json({
      version: 1, kind: "launched",
      player: player.native.launch(`${new URL(c.req.url).origin}${lease.base}index.mpd`, title).player,
    });
  });
  return route;
}
