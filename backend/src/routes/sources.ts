import { Hono } from "hono";
import { getSources } from "../providers";
import { episodeParam, isMediaId } from "../validation";

export function createSourcesRoute(service: typeof getSources = getSources) {
  const route = new Hono();
  route.get("/:type/:tmdbId", async (c) => {
    const type = c.req.param("type");
    const tmdbId = c.req.param("tmdbId");
    if (type !== "movie" && type !== "tv") {
      return c.json({ error: "type must be 'movie' or 'tv'" }, 400);
    }
    if (!isMediaId(tmdbId)) {
      return c.json({ error: "tmdbId must be a positive decimal ID (up to 20 digits)" }, 400);
    }
    const season = type === "tv" ? episodeParam(c.req.query("s"), 99) : 1;
    const episode = type === "tv" ? episodeParam(c.req.query("e"), 9999) : 1;
    if (season === undefined || episode === undefined) {
      return c.json({ error: "season must be 1–99 and episode must be 1–9999" }, 400);
    }
    try {
      const response = await service(type, tmdbId, { season, episode }, c.req.raw.signal);
      c.header("Cache-Control", "no-store");
      return c.json(response);
    } catch {
      return c.json({ error: "failed to resolve sources" }, 502);
    }
  });
  return route;
}

export const sources = createSourcesRoute();
