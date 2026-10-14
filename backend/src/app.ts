import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSourcesRoute } from "./routes/sources";
import { createPlaybackRoute } from "./routes/playback";
import type { PlaybackSessions } from "./moviebox/playback-sessions";
import type { getSources } from "./providers";
import type { Context } from "hono";
import type { MediaRegistry, MediaTransport } from "./media/types";
import { TransportError, validateRange } from "./media/transport";
import { isLoopback, peerAddress } from "./media/loopback";
import { PlayerError } from "./media/player";
import type { PlayerLeases } from "./media/player";
import { TranscodeError } from "./media/transcode";
import type { Transcoder } from "./media/transcode";
import type { NativePlayer } from "./media/native";

export function createApp(options: {
  allowedOrigins: string[];
  accessToken?: string;
  sources?: typeof getSources;
  media?: { registry: MediaRegistry; transport: MediaTransport };
  playback?: PlaybackSessions;
  player?: { leases: PlayerLeases; transcoder: Transcoder; native: NativePlayer };
}) {
  const app = new Hono();
  app.use("*", cors({
    origin: options.allowedOrigins,
    allowHeaders: ["Content-Type", "Authorization", "x-access-token", "x-playback-control", "Range"],
    exposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
    allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
  }));
  app.use("/api/*", async (c, next) => {
    if (options.accessToken && c.req.header("x-access-token") !== options.accessToken) {
      c.header("Cache-Control", "no-store");
      if (c.req.path.startsWith("/api/playback/")) return c.json({ version: 1, kind: "error", code: "unauthorized" }, 401);
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, service: "cine-vault-backend", ts: Date.now() }));
  app.route("/api/sources", createSourcesRoute(options.sources));
  app.route("/api/playback", createPlaybackRoute(options.playback, options.player));

  // Native video/track requests authenticate a scoped capability, not the discovery token.
  app.on(["GET", "HEAD"], "/media/:token", async (c) => {
    if (!options.media) return c.json({ error: "media unavailable" }, 404);
    const method = c.req.method === "HEAD" ? "HEAD" : "GET";
    const resource = options.media.registry.resolve(c.req.param("token"), method);
    if (!resource) return c.json({ error: "invalid or expired capability" }, 403);
    try { validateRange(c.req.header("Range")); }
    catch { return c.json({ error: "invalid byte range" }, 400); }
    try {
      const response = resource.kind === "subtitle"
        ? new Response(method === "HEAD" ? null : await options.media.transport.caption(resource, c.req.raw.signal), {
          headers: { "Content-Type": "text/vtt; charset=utf-8" },
        })
        : await options.media.transport.relay(resource, method, c.req.header("Range"), c.req.raw.signal);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    } catch {
      return c.json({ error: "media unavailable" }, 502);
    }
  });

  // An adaptive stream: the capability belongs to the manifest, and every segment the manifest names
  // resolves inside the directory that capability authorizes. A segment name is a single flat file
  // name — never a path — so one capability can serve a whole title without exposing the CDN.
  const adaptive = async (c: Context, name: string | undefined) => {
    if (!options.media) return c.json({ error: "media unavailable" }, 404);
    const transport = options.media.transport;
    const method = c.req.method === "HEAD" ? "HEAD" : "GET";
    const token = c.req.param("token");
    const resource = token === undefined ? undefined : options.media.registry.resolve(token, method);
    if (!resource || resource.kind !== "manifest" || token === undefined) return c.json({ error: "invalid or expired capability" }, 403);
    const range = c.req.header("Range");
    try {
      validateRange(range);
      if (name === undefined) {
        if (!transport.relayManifest) return c.json({ error: "media unavailable" }, 404);
        return await transport.relayManifest(resource, `/media/${token}/`, method, c.req.raw.signal);
      }
      if (!transport.relaySegment) return c.json({ error: "media unavailable" }, 404);
      const response = await transport.relaySegment(resource, name, range, c.req.raw.signal);
      if (method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
      return response;
    } catch (error) {
      // A name or range this relay will not act on is the caller's mistake, not an upstream fault.
      const code = error instanceof TransportError ? error.code : "unknown";
      if (code === "invalid_range") return c.json({ error: "invalid byte range" }, 400);
      if (code === "invalid_resource") return c.json({ error: "invalid segment name" }, 400);
      if (code === "busy") return c.json({ error: "media busy" }, 503);
      return c.json({ error: "media unavailable" }, 502);
    }
  };
  app.on(["GET", "HEAD"], "/media/:token/index.mpd", (c) => adaptive(c, undefined));
  app.on(["GET", "HEAD"], "/media/:token/:name", (c) => adaptive(c, c.req.param("name")));

  /**
   * The player routes: one stable lease, read by programs running on this machine.
   *
   * A capability expires in minutes and a film does not, so a player is pointed at a lease instead —
   * `/player/<lease>/index.mpd` stays the same URL for hours while the authorization behind it is
   * replaced. What guards these routes is therefore not a token but the peer: `mpv` and `ffmpeg` are
   * started here, and the transcode spends this machine's CPU, so only a loopback caller is served
   * and an unidentifiable peer is refused outright.
   */
  const localOnly = (c: Context): void => {
    if (!isLoopback(peerAddress(c.env))) throw new PlayerError("unknown_lease", 404);
    if (!options.player) throw new PlayerError("unavailable", 503);
  };
  const playerFailure = (c: Context, error: unknown): Response => {
    const code = error instanceof PlayerError || error instanceof TranscodeError || error instanceof TransportError ? error.code : "unknown";
    // A name, a range or a height this relay will not act on is the caller's mistake, not a fault.
    if (code === "invalid_request" || code === "invalid_range") return c.json({ error: "invalid player request" }, 400);
    if (code === "unknown_lease") return c.json({ error: "no such player lease" }, 404);
    if (code === "busy") return c.json({ error: "player busy" }, 503);
    if (code === "invalid_resource") return c.json({ error: "invalid segment name" }, 400);
    if (code === "stale") return c.json({ error: "stream authorization expired" }, 503);
    return c.json({ error: "player unavailable" }, 502);
  };
  app.on(["GET", "HEAD"], "/player/:lease/index.mpd", async (c) => {
    try {
      localOnly(c);
      const method = c.req.method === "HEAD" ? "HEAD" : "GET";
      return await options.player!.leases.manifest(c.req.param("lease"), method, c.req.raw.signal);
    } catch (error) { return playerFailure(c, error); }
  });
  app.get("/player/:lease/stream.mp4", (c) => {
    try {
      localOnly(c);
      const lease = c.req.param("lease");
      const ladder = options.player!.leases.ladder(lease);
      // Strict query parsing: a height must be one the lease advertises, and a start second a number.
      const height = c.req.query("h");
      const from = c.req.query("t");
      if (height !== undefined && !/^\d{1,5}$/.test(height)) return c.json({ error: "invalid player request" }, 400);
      if (from !== undefined && !/^\d{1,5}(?:\.\d{1,3})?$/.test(from)) return c.json({ error: "invalid player request" }, 400);
      const origin = new URL(c.req.url).origin;
      return options.player!.transcoder.stream({
        source: `${origin}${options.player!.leases.manifestPath(lease)}`,
        ladder,
        height: height === undefined ? Math.min(...ladder) : Number(height),
        from: from === undefined ? 0 : Number(from),
      }, c.req.raw.signal);
    } catch (error) { return playerFailure(c, error); }
  });
  app.on(["GET", "HEAD"], "/player/:lease/:name", async (c) => {
    try {
      localOnly(c);
      const method = c.req.method === "HEAD" ? "HEAD" : "GET";
      const response = await options.player!.leases.segment(c.req.param("lease"), c.req.param("name"), c.req.header("Range"), c.req.raw.signal);
      return method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    } catch (error) { return playerFailure(c, error); }
  });
  return app;
}
