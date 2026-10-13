import assert from "node:assert/strict";
import test from "node:test";
import { createSourceService } from "../src/providers";
import { createApp } from "../src/app";
import type { DirectSource } from "../src/providers/types";

const source: DirectSource = {
  type: "direct", provider: "moviebox", label: "MovieBox", format: "progressive", sessionId: "fixture-session",
  expiresAt: 300000, renewAt: 270000,
  qualities: [{ id: "quality", label: "720p", height: 720, url: "/media/fixture" }],
  audios: [{ id: "audio", label: "Source audio", lang: "und" }], selectedAudio: "audio", subtitles: [],
};

test("missing MovieBox setup returns versioned unchanged embed candidates", async () => {
  const result = await createSourceService()("movie", "27205");
  assert.equal(result.version, 1);
  assert.equal(result.moviebox.status, "blocked_setup");
  assert.deepEqual(result.sources.map((item) => item.provider), ["embedwave.cc", "vidcore.org", "vidsrc.to", "vidlink", "2embed"]);
});

test("ready direct source is primary but errors and unsupported formats retain embeds", async () => {
  const ready = await createSourceService(async () => ({ status: "ready", source }))("movie", "27205");
  assert.equal(ready.sources[0], source);
  for (const status of ["ambiguous", "unsupported_adaptive", "unverified"] as const) {
    const result = await createSourceService(async () => ({ status }))("tv", "1399", { season: 2, episode: 3 });
    assert.equal(result.moviebox.status, status);
    assert.equal(result.sources.length, 5);
  }
  const inconsistent = await createSourceService(async () => ({ status: "ready" }))("movie", "27205");
  assert.equal(inconsistent.moviebox.status, "unavailable");
  const failed = await createSourceService(async () => { throw new Error("private upstream metadata"); })("movie", "27205");
  assert.equal(failed.moviebox.status, "unavailable");
  assert.equal(JSON.stringify(failed).includes("private upstream"), false);
});

test("discovery guard is independent of media capabilities", async () => {
  const app = createApp({ allowedOrigins: ["http://localhost:5173"], accessToken: "fixture-access", sources: createSourceService() });
  assert.equal((await app.request("/api/sources/movie/27205")).status, 401);
  const allowed = await app.request("/api/sources/movie/27205", { headers: { "x-access-token": "fixture-access" } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.equal((await app.request("/media/unknown")).status, 404);
});

test("media route refuses expired/invalid tokens and never accepts arbitrary URLs", async () => {
  let relays = 0;
  const app = createApp({ allowedOrigins: ["http://localhost:5173"], media: {
    registry: { register: () => "fixture", revoke: () => undefined, resolve: (token) => token === "fixture" ? { kind: "video", url: "https://example.com/video", headers: {} } : undefined },
    transport: { probe: async () => true, caption: async () => "WEBVTT\n", relay: async () => { relays++; return new Response("fixture", { headers: { "content-type": "video/mp4" } }); } },
  } });
  assert.equal((await app.request("/media/unknown?url=https://example.com")).status, 403);
  assert.equal((await app.request("/media/fixture", { method: "POST" })).status, 404);
  assert.equal((await app.request("/media/fixture", { headers: { Range: "bytes=1-2,4-5" } })).status, 400);
  const response = await app.request("/media/fixture", { headers: { Origin: "http://localhost:5173" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(relays, 1);
});
