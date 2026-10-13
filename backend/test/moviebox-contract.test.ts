import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app";
import { createMediaRegistry } from "../src/media/registry";
import { createSourceService } from "../src/providers";
import { parseSourcesResponse } from "../../frontend/src/features/watch/source-response";
import { MovieBoxMetadata } from "../src/moviebox/metadata";
import { MovieBoxClient } from "../src/moviebox/client";
import { createMovieBoxResolver } from "../src/moviebox/resolver";
import type { MediaTransport } from "../src/media/types";

test("cold source discovery initializes anonymous visitor session automatically without init or user login", async () => {
  const subject = { subjectId: "12345", title: "Synthetic Visitor Film", subjectType: 1, year: 2020 };
  const requests: string[] = [];
  let logins = 0;
  const client = new MovieBoxClient({
    movieboxSecretHex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d",
    identity: { userAgent: "synthetic-client", clientInfo: '{"device_id":"synthetic-device"}' },
    maxAttempts: 1,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      if (url.pathname.endsWith("/visitor-login")) {
        logins++;
        assert.equal(init?.body, "{}");
        assert.equal(new Headers(init?.headers).get("authorization"), null);
        return Response.json({ data: { token: "synthetic-visitor-session" } });
      }
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-visitor-session");
      const data = url.pathname.endsWith("/search/v2") ? { list: [subject] } :
        url.pathname.endsWith("/get") ? subject :
        url.pathname.endsWith("/resource") ? { resources: [{ resourceId: "999", resourceLink: "https://cdn.example.test/fixture.mp4", resolution: 720, codec: "H264", format: "MP4" }] } :
        url.pathname.endsWith("/play-info/v2") ? { streams: [] } : { extCaptions: [] };
      return Response.json({ data });
    },
  });
  const registry = createMediaRegistry({ signingKey: "cd".repeat(32) });
  const transport: MediaTransport = { probe: async () => true, caption: async () => "WEBVTT\n", relay: async () => new Response(null) };
  const resolver = createMovieBoxResolver({
    registry, transport,
    lookup: async () => ({ type: "movie", titles: [subject.title], year: subject.year }),
    metadata: (signal) => new MovieBoxMetadata({
      get: (path) => client.get(path, signal), search: (keyword, page) => client.search(keyword, page, signal),
    }),
  });
  const app = createApp({ allowedOrigins: [], sources: createSourceService(resolver) });
  // Deliberately do not call client.init(), submit a username/password or preload a token.
  const responses = await Promise.all([app.request("/api/sources/movie/42"), app.request("/api/sources/movie/43")]);
  responses.push(await app.request("/api/sources/movie/44"));
  const direct = [];
  for (const response of responses) {
    const parsed = parseSourcesResponse(await response.json());
    assert.equal(parsed.moviebox.status, "ready");
    assert.ok(parsed.sources[0]?.type === "direct");
    direct.push(parsed.sources[0]);
  }
  assert.equal(new Set(direct.map((source) => source.sessionId)).size, 3);
  assert.equal(new Set(direct.map((source) => source.controlToken)).size, 3);
  assert.equal(logins, 1);
  assert.equal(requests[0], "/wefeed-mobile-bff/user-api/visitor-login");
  assert.ok(client.diagnostics().sessionReuses > 0);
});

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
