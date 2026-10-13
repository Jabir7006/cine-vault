import assert from "node:assert/strict";
import test from "node:test";
import { MovieBoxMetadata } from "../src/moviebox/metadata";
import { createMovieBoxResolver } from "../src/moviebox/resolver";
import { createMediaRegistry } from "../src/media/registry";
import type { MediaResource, MediaTransport } from "../src/media/types";

const instant = 1_800_000_000_000;
const subject = { subjectId: "9000000000000000001", title: "Synthetic Film", subjectType: 1, year: 2020 };
const progressive = { resourceId: "101", resourceLink: "https://media.example.test/fixture.mp4", format: "MP4", codecName: "H264", resolution: 720 };

function fixture(options: {
  resources?: unknown[]; streams?: unknown[]; subject?: typeof subject; captionsFail?: boolean;
  probe?: boolean; tv?: boolean; episodes?: number[];
  captions?: unknown[]; slowCaption?: boolean; slowSecondProbe?: boolean; playInfoFail?: boolean;
} = {}) {
  let calls = 0;
  let probes = 0;
  let clock = instant;
  const detail = options.subject ?? { ...subject, ...(options.tv ? { subjectType: 2, seasons: [{ se: 1, episodeNumbers: options.episodes ?? [] }] } : {}) };
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), now: () => clock });
  const metadata = new MovieBoxMetadata({
    search: async () => { calls++; return { list: [detail] }; },
    get: async (path) => {
      calls++;
      if (path.includes("/get?")) return detail;
      if (path.includes("/season-info?")) return { seasons: [{ se: 1, maxEp: 99, episodeNumbers: options.episodes ?? [] }] };
      if (path.includes("/resource?")) return { resources: options.resources ?? [progressive], hasMore: false };
      if (path.includes("/play-info/v2?")) {
        if (options.playInfoFail) throw new Error("Synthetic unavailable play-info");
        return { streams: options.streams ?? [] };
      }
      if (options.captionsFail) throw new Error("private caption failure");
      return { extCaptions: options.captions ?? [{ url: "https://captions.example.test/fixture.srt", lan: "en", lanName: "English" }] };
    },
  });
  const transport: MediaTransport = {
    probe: async () => {
      probes++;
      if (options.slowSecondProbe && probes > 1) return new Promise<boolean>(() => undefined);
      return options.probe ?? true;
    },
    caption: async () => options.slowCaption ? new Promise<string>(() => undefined) : "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSynthetic caption\n",
    relay: async () => new Response(null),
  };
  const resolve = createMovieBoxResolver({
    now: () => clock, metadata: () => metadata, registry, transport,
    lookup: async () => ({ type: options.tv ? "tv" : "movie", titles: ["Synthetic Film"], year: 2020 }),
  });
  return { resolve, registry, get calls() { return calls; }, get probes() { return probes; }, tick: (ms: number) => { clock += ms; } };
}

test("verified progressive is primary-ready with no upstream URLs, IDs or headers in public contract", async () => {
  const f = fixture();
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready");
  assert.ok(result.source);
  assert.equal(result.source.qualities[0]?.label, "720p");
  assert.equal(result.source.subtitles[0]?.label, "English");
  assert.equal(result.source.audios[0]?.label, "Source audio");
  const output = JSON.stringify(result);
  assert.equal(output.includes("media.example.test"), false);
  assert.equal(output.includes(subject.subjectId), false);
  assert.equal(output.includes("signCookie"), false);
  const token = result.source.qualities[0]!.url.slice("/media/".length);
  assert.equal(f.registry.resolve(token, "GET")?.kind, "video");
  const calls = f.calls;
  assert.equal(await f.resolve("movie", "123", {}), result);
  assert.equal(f.calls, calls);
  f.tick(270001);
  const renewed = await f.resolve("movie", "123", {});
  assert.equal(renewed.status, "ready");
  assert.notEqual(renewed.source?.sessionId, result.source.sessionId);
});

test("MP4-labelled DASH and policy resources do not get probed or minted", async () => {
  const dash = fixture({ resources: [{ ...progressive, resourceLink: "https://media.example.test/dash/index.mpd" }] });
  assert.equal((await dash.resolve("movie", "123", {})).status, "unsupported_adaptive");
  assert.equal(dash.probes, 0);
  const signed = fixture({ resources: [{ ...progressive, signCookie: "synthetic opaque authorization" }] });
  assert.equal((await signed.resolve("movie", "123", {})).status, "unverified");
  assert.equal(signed.probes, 0);
});

test("unknown container evidence, codec or resolution never creates fake options", async () => {
  const invalid = fixture({ probe: false });
  assert.equal((await invalid.resolve("movie", "123", {})).status, "unverified");
  for (const resource of [{ ...progressive, codecName: "HEVC" }, { ...progressive, resolution: undefined }]) {
    const f = fixture({ resources: [resource] });
    assert.equal((await f.resolve("movie", "123", {})).status, "unverified");
    assert.equal(f.probes, 0);
  }
});

test("explicit episode proof is required; maxEp and mismatched resources never suffice", async () => {
  const unknown = fixture({ tv: true, resources: [{ ...progressive, se: 1, ep: 2 }] });
  assert.equal((await unknown.resolve("tv", "123", { season: 1, episode: 10 })).status, "unverified");
  assert.equal(unknown.probes, 0);
  const valid = fixture({ tv: true, resources: [{ ...progressive, se: 1, ep: 10 }] });
  assert.equal((await valid.resolve("tv", "123", { season: 1, episode: 10 })).status, "ready");
});

test("TV season proof cannot promote an unnumbered resource from another episode", async () => {
  const f = fixture({ tv: true, episodes: [10], resources: [progressive] });
  const result = await f.resolve("tv", "123", { season: 1, episode: 10 });
  assert.equal(result.status, "unsupported_format");
  assert.equal(f.probes, 0);
});

test("caption failures preserve verified video; duplicate resources do not manufacture choices", async () => {
  const f = fixture({ resources: [progressive, progressive], captionsFail: true });
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready");
  assert.equal(result.source?.qualities.length, 1);
  assert.equal(result.source?.subtitles.length, 0);
});

test("optional slow captions and later qualities never discard the first verified video", async () => {
  const second = { ...progressive, resourceId: "102", resolution: 360, resourceLink: "https://media.example.test/fixture-small.mp4" };
  const f = fixture({ resources: [progressive, second], slowCaption: true, slowSecondProbe: true });
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready");
  assert.equal(result.source?.qualities.length, 1);
  assert.equal(result.source?.subtitles.length, 0);
});

test("invalid optional caption labels cannot poison the public source contract", async () => {
  for (const label of ["English\\nInjected".replace("\\n", "\n"), "English‮", "English\u0080"]) {
    const f = fixture({ captions: [{ url: "https://captions.example.test/fixture.srt", lan: "en", lanName: label }] });
    const result = await f.resolve("movie", "123", {});
    assert.equal(result.status, "ready");
    assert.equal(result.source?.subtitles.length, 0);
  }
});

test("independently verified resource remains usable when play-info fails", async () => {
  const f = fixture({ playInfoFail: true });
  assert.equal((await f.resolve("movie", "123", {})).status, "ready");
});

test("cached ready source is rebuilt after registry revocation instead of advertising dead capabilities", async () => {
  const f = fixture();
  const first = await f.resolve("movie", "123", {});
  assert.ok(first.source);
  f.registry.revoke(first.source.qualities[0]!.url.slice("/media/".length));
  const renewed = await f.resolve("movie", "123", {});
  assert.equal(renewed.status, "ready");
  assert.notEqual(renewed.source?.sessionId, first.source.sessionId);
});

test("concurrent identical lookups singleflight; aborted caller cannot mint stale playback", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.resolve("movie", "123", {}), f.resolve("movie", "123", {})]);
  assert.equal(a, b);
  assert.equal(f.probes, 1);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await f.resolve("movie", "456", {}, controller.signal)).status, "unavailable");
});
