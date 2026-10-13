import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSourcesRoute } from "./routes/sources";
import { createPlaybackRoute } from "./routes/playback";
import type { PlaybackSessions } from "./moviebox/playback-sessions";
import type { getSources } from "./providers";
import type { MediaRegistry, MediaTransport } from "./media/types";
import { validateRange } from "./media/transport";

export function createApp(options: {
  allowedOrigins: string[];
  accessToken?: string;
  sources?: typeof getSources;
  media?: { registry: MediaRegistry; transport: MediaTransport };
  playback?: PlaybackSessions;
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
  app.route("/api/playback", createPlaybackRoute(options.playback));

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
  return app;
}
