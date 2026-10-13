import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app";
import { createMediaRegistry } from "../src/media/registry";
import { createSourceService } from "../src/providers";
import { parseSourcesResponse } from "../../frontend/src/features/watch/source-response";
import { MovieBoxMetadata } from "../src/moviebox/metadata";
import { createMovieBoxResolver } from "../src/moviebox/resolver";
import type { MediaTransport } from "../src/media/types";

// Synthetic endpoint shapes; this tests contract composition, not upstream compatibility.
test("discovery -> strict frontend parser -> independently authenticated media capability", async () => {
  const subject = { subjectId: "12345", title: "Synthetic Contract Film", subjectType: 1, year: 2020 };
  const registry = createMediaRegistry({ signingKey: "cd".repeat(32) });
  let relays = 0;
  const transport: MediaTransport = {
    probe: async () => true,
    caption: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFixture\n",
    relay: async (_resource, method) => { relays++; return new Response(method === "HEAD" ? null : "synthetic media", { headers: { "content-type": "video/mp4" } }); },
  };
  const metadata = new MovieBoxMetadata({
    search: async () => ({ list: [subject] }),
    get: async (path) => path.includes("/get?") ? subject : path.includes("/resource?") ? {
      resources: [{ resourceId: "999", resourceLink: "https://cdn.example.test/synthetic.mp4", resolution: 720, codec: "H264", format: "MP4" }],
    } : path.includes("/play-info") ? { streams: [] } : { extCaptions: [] },
  });
  const resolver = createMovieBoxResolver({ registry, transport, metadata: () => metadata,
    lookup: async () => ({ type: "movie", titles: [subject.title], year: subject.year }),
  });
  const app = createApp({ allowedOrigins: ["http://localhost:5173"], accessToken: "fixture-access",
    sources: createSourceService(resolver), media: { registry, transport },
  });
  assert.equal((await app.request("/api/sources/movie/42")).status, 401);
  const discovery = await app.request("/api/sources/movie/42", { headers: { "x-access-token": "fixture-access" } });
  const parsed = parseSourcesResponse(await discovery.json());
  assert.equal(parsed.moviebox.status, "ready");
  assert.equal(parsed.sources.length, 6);
  const source = parsed.sources[0];
  assert.ok(source?.type === "direct");
  const capabilityPath = source.qualities[0]!.url;
  const playback = await app.request(capabilityPath, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(playback.status, 200);
  assert.equal(playback.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(await playback.text(), "synthetic media");
  assert.equal(relays, 1);
  assert.equal((await app.request(capabilityPath.slice(0, -1) + "!", { headers: { "x-access-token": "fixture-access" } })).status, 403);
  assert.equal(relays, 1);
});
