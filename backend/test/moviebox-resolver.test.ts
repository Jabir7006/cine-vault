import assert from "node:assert/strict";
import test from "node:test";
import { MovieBoxMetadata } from "../src/moviebox/metadata";
import { createMovieBoxResolver } from "../src/moviebox/resolver";
import { createMediaRegistry } from "../src/media/registry";
import type { MediaProbeEvidence, MediaResource, MediaTransport } from "../src/media/types";
import { TransportError } from "../src/media/transport";
import { MovieBoxError } from "../src/moviebox/errors";
import { warnMovieBoxDiagnostic } from "../src/moviebox/diagnostics";
import type { MovieBoxDiagnostic, MovieBoxDiagnosticCallback } from "../src/moviebox/diagnostics";

const instant = 1_800_000_000_000;
const subject = { subjectId: "9000000000000000001", title: "Synthetic Film", subjectType: 1, year: 2020 };
const progressive = { resourceId: "101", resourceLink: "https://media.example.test/fixture.mp4", format: "MP4", codecName: "H264", resolution: 720 };
/** The downgrade advertisement: the media host's catch-all bucket, which is all that gives it away. */
const notice = { resourceId: "101", resourceLink: "https://macdn.aoneroom.com/other/2026/10/10/notice.mp4", format: "MP4", codecName: "HEVC", resolutions: "1080,720,480" };
/** The same row carrying the authorization that names the signed manifest behind the title. */
const authorizedNotice = (directory = "https://sbcdn3.example.test/dash/9f/film") =>
  ({ ...notice, signCookie: `Edge-Cache-Cookie=urlprefix=${Buffer.from(directory).toString("base64url")}` });

function fixture(options: {
  resources?: unknown[]; streams?: unknown[]; subject?: typeof subject; captionsFail?: boolean;
  probe?: boolean; tv?: boolean; episodes?: number[];
  captions?: unknown[]; slowCaption?: boolean; slowSecondProbe?: boolean; playInfoFail?: boolean;
  dubs?: unknown[]; alternate?: Record<string, unknown>; alternateResources?: unknown[]; slowAlternate?: boolean;
  diagnostic?: MovieBoxDiagnosticCallback; noTarget?: boolean; searchRows?: unknown[]; detailRow?: unknown;
  resourcesError?: unknown; resourcesErrorPage?: number; resourcePages?: Array<{ resources: unknown[]; hasMore: boolean }>;
  playInfoError?: unknown; probeError?: unknown; probeEvidence?: MediaProbeEvidence;
  /** One play-info listing per call; the last entry answers every request after it. */
  streamsSequence?: unknown[][];
  manifest?: (url: string) => { xml: string; heights: number[] };
  playInfoAttempts?: number;
} = {}) {
  let calls = 0;
  let probes = 0;
  let playInfoCalls = 0;
  const paths: string[] = [];
  const manifestReads: string[] = [];
  let clock = instant;
  const detail = { ...(options.subject ?? { ...subject, ...(options.tv ? { subjectType: 2, seasons: [{ se: 1, episodeNumbers: options.episodes ?? [] }] } : {}) }), dubs: options.dubs ?? [] };
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), now: () => clock });
  const metadata = new MovieBoxMetadata({
    search: async () => { calls++; return { list: options.searchRows ?? [detail] }; },
    get: async (path) => {
      calls++;
      paths.push(path);
      const requested = new URL(path, "https://metadata.example.test").searchParams.get("subjectId");
      const alternate = requested !== subject.subjectId;
      if (path.includes("/get?")) {
        if (alternate && options.slowAlternate) return new Promise<unknown>(() => undefined);
        return alternate ? options.alternate : options.detailRow ?? detail;
      }
      if (path.includes("/season-info?")) return { seasons: [{ se: 1, maxEp: 99, episodeNumbers: alternate ? [] : options.episodes ?? [] }] };
      if (path.includes("/resource?")) {
        const page = Number(new URL(path, "https://metadata.example.test").searchParams.get("page"));
        if (options.resourcesError && (options.resourcesErrorPage === undefined || options.resourcesErrorPage === page)) throw options.resourcesError;
        return options.resourcePages?.[page - 1] ?? { resources: alternate ? options.alternateResources ?? [] : options.resources ?? [progressive], hasMore: false };
      }
      if (path.includes("/play-info/v2?")) {
        playInfoCalls++;
        if (options.playInfoError) throw options.playInfoError;
        if (options.playInfoFail) throw new Error("Synthetic unavailable play-info");
        const sequence = options.streamsSequence;
        if (sequence?.length) return { streams: sequence[Math.min(playInfoCalls - 1, sequence.length - 1)] };
        return { streams: options.streams ?? [] };
      }
      if (options.captionsFail) throw new Error("private caption failure");
      return { extCaptions: options.captions ?? [{ url: "https://captions.example.test/fixture.srt", lan: "en", lanName: "English" }] };
    },
  });
  const transport: MediaTransport = {
    probe: async () => {
      probes++;
      if (options.probeError) throw options.probeError;
      if (options.slowSecondProbe && probes > 1) return new Promise<boolean>(() => undefined);
      return options.probe ?? true;
    },
    ...(options.probeEvidence ? { probeEvidence: async () => { probes++; return options.probeEvidence!; } } : {}),
    ...(options.manifest ? {
      readManifest: async (resource: MediaResource) => { manifestReads.push(resource.url); return options.manifest!(resource.url); },
    } : {}),
    caption: async () => options.slowCaption ? new Promise<string>(() => undefined) : "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSynthetic caption\n",
    relay: async () => new Response(null),
  };
  const resolve = createMovieBoxResolver({
    now: () => clock, metadata: () => metadata, registry, transport, diagnostic: options.diagnostic,
    playInfoAttempts: options.playInfoAttempts,
    lookup: async () => options.noTarget ? undefined : ({ type: options.tv ? "tv" : "movie", titles: ["Synthetic Film"], year: 2020 }),
  });
  return {
    resolve, registry, paths, manifestReads,
    get calls() { return calls; }, get probes() { return probes; }, get playInfoCalls() { return playInfoCalls; },
    tick: (ms: number) => { clock += ms; },
  };
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
  const independent = await f.resolve("movie", "123", {});
  assert.notEqual(independent.source?.sessionId, result.source.sessionId);
  assert.notEqual(independent.source?.controlToken, result.source.controlToken);
  assert.notEqual(independent.source?.qualities[0]?.url, result.source.qualities[0]?.url);
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
  // signCookie streams are now probed with the cookie attached; probe success → ready.
  const signed = fixture({ resources: [{ ...progressive, signCookie: "Edge-Cache-Cookie=synthetic" }] });
  assert.equal((await signed.resolve("movie", "123", {})).status, "ready");
  assert.equal(signed.probes, 1);
  // signCookie stream that fails probing → unverified with media_probe stage.
  const signedFail = fixture({ resources: [{ ...progressive, signCookie: "Edge-Cache-Cookie=synthetic" }], probe: false });
  assert.equal((await signedFail.resolve("movie", "123", {})).status, "unverified");
  assert.equal(signedFail.probes, 1);
});

test("the downgrade advertisement is asked for again until it carries the authorization", async () => {
  const f = fixture({
    resources: [],
    streamsSequence: [[notice], [notice], [authorizedNotice()]],
    manifest: () => ({ xml: "<MPD/>", heights: [1080, 720, 480] }),
  });
  const result = await f.resolve("movie", "123", {});
  // The same row is served with and without the authorization; only the one with it can play.
  assert.equal(f.playInfoCalls, 3);
  assert.equal(result.status, "ready");
  assert.equal(result.source?.qualities[0]?.stream, "adapted");
  assert.deepEqual(result.source?.qualities[0]?.heights, [1080, 720, 480]);
  const token = result.source!.qualities[0]!.url.slice("/media/".length);
  assert.equal(f.registry.resolve(token, "GET")?.kind, "manifest");
  // The advertisement itself is never probed, and never becomes an option.
  assert.equal(f.probes, 0);
});

test("an advertisement that never carries an authorization is reported, not retried forever", async () => {
  const f = fixture({ resources: [], streamsSequence: [[notice]] });
  assert.equal((await f.resolve("movie", "123", {})).status, "unsupported_format");
  assert.equal(f.playInfoCalls, 4);
  assert.deepEqual(f.manifestReads, []);
});

test("a listing that is not an advertisement is taken as it is", async () => {
  // A row that already carries the authorization is usable on the first answer...
  const authorized = fixture({ resources: [], streams: [authorizedNotice()], manifest: () => ({ xml: "<MPD/>", heights: [1080] }) });
  assert.equal((await authorized.resolve("movie", "123", {})).status, "ready");
  assert.equal(authorized.playInfoCalls, 1);
  // ...and so is an ordinary progressive file, which needs no authorization at all.
  const plain = fixture({ resources: [], streams: [progressive] });
  assert.equal((await plain.resolve("movie", "123", {})).status, "ready");
  assert.equal(plain.playInfoCalls, 1);
});

test("a refusal the advertisement caused is asked for again, because retrying is its remedy", async () => {
  const f = fixture({
    resources: [],
    streamsSequence: [[notice], [notice], [notice], [notice], [authorizedNotice()]],
    manifest: () => ({ xml: "<MPD/>", heights: [1080, 720, 480] }),
  });
  // Every attempt answered with the advertisement and no authorization: the refusal that follows is
  // the one the viewer's own retry can reverse, because the same request carries the authorization
  // at random. Remembering it would answer that retry with the identical refusal.
  assert.equal((await f.resolve("movie", "123", {})).status, "unsupported_format");
  assert.equal(f.playInfoCalls, 4);
  assert.equal((await f.resolve("movie", "123", {})).status, "ready");
  assert.equal(f.playInfoCalls, 5);
});

test("the advertisement attempt count is bounded and configurable", async () => {
  for (const playInfoAttempts of [0, 9, 1.5]) {
    assert.throws(() => fixture({ playInfoAttempts }), /Invalid moviebox resolver configuration/);
  }
  const once = fixture({ resources: [], streamsSequence: [[notice]], playInfoAttempts: 1 });
  assert.equal((await once.resolve("movie", "123", {})).status, "unsupported_format");
  assert.equal(once.playInfoCalls, 1);
});

test("unknown container evidence, codec or resolution never creates fake options", async () => {
  const invalid = fixture({ probe: false });
  assert.equal((await invalid.resolve("movie", "123", {})).status, "unverified");
  // HEVC is now accepted as a supported codec; it gets probed like H.264.
  const hevc = fixture({ resources: [{ ...progressive, codecName: "HEVC" }] });
  assert.equal((await hevc.resolve("movie", "123", {})).status, "ready");
  assert.equal(hevc.probes, 1);
  // Missing resolution means no height evidence → height_missing, not probed.
  const noRes = fixture({ resources: [{ ...progressive, resolution: undefined }] });
  assert.equal((await noRes.resolve("movie", "123", {})).status, "unverified");
  assert.equal(noRes.probes, 0);
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

test("resource HTTP 400 stops pagination and independently verified play-info is ready and silent", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const f = fixture({ resourcesError: new MovieBoxError("http", 400), streams: [progressive],
    diagnostic: (event) => { events.push(event); } });
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready");
  assert.equal(f.probes, 1);
  assert.equal(result.source?.qualities[0]?.label, "720p");
  assert.equal(f.registry.resolve(result.source!.qualities[0]!.url.slice("/media/".length), "GET")?.kind, "video");
  assert.deepEqual(f.paths.filter((path) => path.includes("/resource?")), [
    // The listing API rejects a page larger than the reference client's twenty rows.
    `/wefeed-mobile-bff/subject-api/resource?subjectId=${subject.subjectId}&page=1&perPage=20`,
  ]);
  assert.deepEqual(f.paths.filter((path) => path.includes("/play-info/v2?")), [
    `/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=${subject.subjectId}`,
  ]);
  assert.deepEqual(events, []);
});

test("resource HTTP 400 on a later page retains already listed independently verified resources", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const f = fixture({ resourcePages: [{ resources: [progressive], hasMore: true }],
    resourcesErrorPage: 2, resourcesError: new MovieBoxError("http", 400),
    diagnostic: (event) => { events.push(event); } });
  assert.equal((await f.resolve("movie", "123", {})).status, "ready");
  assert.equal(f.paths.filter((path) => path.includes("/resource?")).length, 2);
  assert.equal(f.paths.filter((path) => path.includes("/play-info/v2?")).length, 1);
  assert.equal(f.probes, 1);
  assert.deepEqual(events, []);
});

test("empty resource-400 fallback keeps the sanitized original diagnostic and unsupported_format status", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const error = Object.assign(new MovieBoxError("http", 400), {
    url: "https://private.example/?token=private", headers: { authorization: "private" }, body: "private-body",
  });
  const f = fixture({ resourcesError: error, streams: [], diagnostic: (event) => { events.push(event); } });
  assert.deepEqual(await f.resolve("movie", "123", {}), { status: "unsupported_format" });
  assert.deepEqual(events, [{ status: "unsupported_format", stage: "resources", code: "http", httpStatus: 400 }]);
  assert.equal(f.paths.filter((path) => path.includes("/resource?")).length, 1);
  assert.equal(f.paths.filter((path) => path.includes("/play-info/v2?")).length, 1);
  assert.equal(f.probes, 0);
});

test("specific fallback rejection wins over the resource-400 diagnostic without changing status", async () => {
  const cases: Array<{ options: Parameters<typeof fixture>[0]; status: string; stage: string; code: string; httpStatus?: number }> = [
    { options: { playInfoError: new MovieBoxError("denied", 403) }, status: "unsupported_format", stage: "play_info", code: "denied", httpStatus: 403 },
    { options: { streams: [{ ...progressive, format: "MKV" }] }, status: "unsupported_format", stage: "stream", code: "format" },
    { options: { streams: [{ ...progressive, codecName: "HEVC" }], probe: false }, status: "unverified", stage: "media_probe", code: "probe_rejected" },
    { options: { streams: [{ ...progressive, resourceLink: "https://media.example.test/dash/index.mpd" }] }, status: "unsupported_adaptive", stage: "stream", code: "dash" },
    { options: { streams: [progressive], probe: false }, status: "unverified", stage: "media_probe", code: "probe_rejected" },
    { options: { streams: [progressive], probeError: new TransportError("blocked_address") }, status: "unavailable", stage: "media_probe", code: "blocked_address" },
  ];
  for (const { options, ...expected } of cases) {
    const events: MovieBoxDiagnostic[] = [];
    const f = fixture({ ...options, resourcesError: new MovieBoxError("http", 400), diagnostic: (event) => { events.push(event); } });
    assert.deepEqual(await f.resolve("movie", "123", {}), { status: expected.status });
    assert.deepEqual(events, [expected]);
    assert.equal(f.paths.filter((path) => path.includes("/play-info/v2?")).length, 1);
  }
});

test("only actual MovieBoxError http 400 allows fallback; authorization, rate limit and other errors stop before play-info", async () => {
  const cases: Array<{ error: unknown; code: string; httpStatus?: number }> = [
    { error: new MovieBoxError("unauthorized", 401), code: "unauthorized", httpStatus: 401 },
    { error: new MovieBoxError("denied", 403), code: "denied", httpStatus: 403 },
    { error: new MovieBoxError("rate_limit", 429), code: "rate_limit", httpStatus: 429 },
    { error: new MovieBoxError("http", 403), code: "http", httpStatus: 403 },
    { error: new MovieBoxError("http", 429), code: "http", httpStatus: 429 },
    { error: new MovieBoxError("http", 500), code: "http", httpStatus: 500 },
    { error: new MovieBoxError("network"), code: "network" },
    { error: new MovieBoxError("timeout"), code: "timeout" },
    { error: new MovieBoxError("malformed", 400), code: "malformed", httpStatus: 400 },
    { error: Object.assign(new Error("synthetic"), { code: "http", status: 400 }), code: "unknown" },
  ];
  for (const { error, ...failure } of cases) {
    const events: MovieBoxDiagnostic[] = [];
    const f = fixture({ resourcesError: error, streams: [progressive], diagnostic: (event) => { events.push(event); } });
    assert.deepEqual(await f.resolve("movie", "123", {}), { status: "unavailable" });
    assert.deepEqual(events, [{ status: "unavailable", stage: "resources", ...failure }]);
    assert.equal(f.paths.filter((path) => path.includes("/resource?")).length, 1);
    assert.equal(f.paths.some((path) => path.includes("/play-info/v2?")), false);
    assert.equal(f.probes, 0);
  }
});

test("TV resource-400 fallback proves the episode from the season, never from the request or a returned stream", async () => {
  // An explicit list is authoritative: play-info answering for an omitted episode is not proof.
  for (const streams of [[], [progressive], [{ ...progressive, se: 1, ep: 2 }]]) {
    const events: MovieBoxDiagnostic[] = [];
    const f = fixture({ tv: true, detailRow: { ...subject, subjectType: 2, seasons: [{ se: 1, maxEp: 99, episodeNumbers: [2, 4] }] },
      resourcesError: new MovieBoxError("http", 400), streams, diagnostic: (event) => { events.push(event); } });
    assert.deepEqual(await f.resolve("tv", "123", { season: 1, episode: 10 }), { status: "unverified" });
    assert.deepEqual(events, [{ status: "unverified", stage: "episode", code: "episode_evidence_missing" }]);
    assert.deepEqual(f.paths.filter((path) => path.includes("/play-info/v2?")), [
      `/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=${subject.subjectId}&se=1&ep=10`,
    ]);
    assert.equal(f.probes, 0);
  }
  // A bound-only season is proven up to maxEp and no further; the returned stream is still required.
  for (const [maxEp, status, probes] of [[99, "ready", 1], [9, "unverified", 0]] as const) {
    const events: MovieBoxDiagnostic[] = [];
    const f = fixture({ tv: true, detailRow: { ...subject, subjectType: 2, seasons: [{ se: 1, maxEp }] },
      resourcesError: new MovieBoxError("http", 400), streams: [progressive], diagnostic: (event) => { events.push(event); } });
    assert.equal((await f.resolve("tv", "123", { season: 1, episode: 10 })).status, status);
    assert.deepEqual(events, status === "ready" ? [] : [{ status: "unverified", stage: "episode", code: "episode_evidence_missing" }]);
    assert.equal(f.probes, probes);
  }
});

test("TV resource-400 fallback accepts explicit play-info or existing seasons episodeNumbers and still probes", async () => {
  for (const options of [
    { streams: [{ ...progressive, se: 1, ep: 10 }] },
    { episodes: [10], streams: [progressive] },
    { episodes: [10], detailRow: { ...subject, subjectType: 2 }, streams: [progressive] },
  ]) {
    const events: MovieBoxDiagnostic[] = [];
    const f = fixture({ ...options, tv: true, resourcesError: new MovieBoxError("http", 400), diagnostic: (event) => { events.push(event); } });
    assert.equal((await f.resolve("tv", "123", { season: 1, episode: 10 })).status, "ready");
    assert.equal(f.probes, 1);
    assert.equal(f.paths.filter((path) => path.includes("/play-info/v2?")).length, 1);
    assert.deepEqual(events, []);
  }
  const events: MovieBoxDiagnostic[] = [];
  const wrong = fixture({ tv: true, episodes: [10], resourcesError: new MovieBoxError("http", 400),
    streams: [{ ...progressive, se: 1, ep: 2 }], diagnostic: (event) => { events.push(event); } });
  assert.deepEqual(await wrong.resolve("tv", "123", { season: 1, episode: 10 }), { status: "unsupported_format" });
  assert.deepEqual(events, [{ status: "unsupported_format", stage: "resources", code: "http", httpStatus: 400 }]);
  assert.equal(wrong.probes, 0);
});

test("resource-400 fallback does not weaken resource or play-info authorization metadata gates", async () => {
  for (const auth of [{ signCookie: "synthetic-private" }, { policy: { private: "synthetic" } }, { headers: { authorization: "synthetic-private" } }]) {
    for (const listed of [false, true]) {
      const events: MovieBoxDiagnostic[] = [];
      const candidate = { ...progressive, ...auth };
      const f = fixture({ resourcesError: new MovieBoxError("http", 400),
        ...(listed ? { resourcePages: [{ resources: [candidate], hasMore: true }], resourcesErrorPage: 2, streams: [] } : { streams: [candidate] }),
        diagnostic: (event) => { events.push(event); } });
      // Auth-gated streams are now probed with the cookie attached.
      // Default probe succeeds → ready. Auth metadata does not weaken the 400 fallback.
      const result = await f.resolve("movie", "123", {});
      assert.equal(result.status, "ready");
      assert.equal(f.probes, 1);
    }
  }
});

test("resource-400 fallback cannot bypass wrong identity and ordinary TV keeps its early episode gate", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const wrong = fixture({ detailRow: { ...subject, year: 2021 }, resourcesError: new MovieBoxError("http", 400),
    streams: [progressive], diagnostic: (event) => { events.push(event); } });
  assert.deepEqual(await wrong.resolve("movie", "123", {}), { status: "unverified" });
  assert.deepEqual(events, [{ status: "unverified", stage: "detail", code: "detail_mismatch" }]);
  assert.equal(wrong.paths.some((path) => path.includes("/resource?") || path.includes("/play-info/v2?")), false);
  assert.equal(wrong.probes, 0);
  const ordinary = fixture({ tv: true, resources: [], streams: [{ ...progressive, se: 1, ep: 10 }] });
  assert.deepEqual(await ordinary.resolve("tv", "123", { season: 1, episode: 10 }), { status: "unverified" });
  assert.equal(ordinary.paths.some((path) => path.includes("/play-info/v2?")), false);
  assert.equal(ordinary.probes, 0);
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

test("verified explicit dub relationships expose server-owned selection only", async () => {
  const dub = { ...subject, subjectId: "2", lang: "bn", label: "Bangla" };
  const f = fixture({ dubs: [dub], alternate: dub,
    alternateResources: [{ ...progressive, resourceId: "202", resourceLink: "https://media.example.test/dub.mp4" }] });
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready");
  assert.equal(result.source?.audios.length, 2);
  assert.equal(result.source?.audios[1]?.label, "Bangla");
  assert.equal(JSON.stringify(result).includes('"subjectId"'), false);
  const source = result.source!;
  const prep = await f.resolve.playback.prepare(source.sessionId, source.controlToken, { version: 1, baseRevision: 1, reason: "audio", audioId: source.audios[1]!.id });
  assert.equal(prep.source.selectedAudio, source.audios[1]!.id);
  assert.deepEqual(prep.continuity, { kind: "none" });
});

test("dub missing/contradictory identity, conflicting IDs and wrong detail never become options", async () => {
  const dub = { ...subject, subjectId: "2", lang: "bn", label: "Bangla" };
  for (const dubs of [[{ subjectId: "2", lang: "bn", label: "Bangla" }], [{ ...dub, title: "Synthetic Film (Bangla Dub)" }],
    [{ ...dub, year: 2021 }], [dub, { ...dub, lang: "hi" }], [{ ...dub, lang: "" }]]) {
    const f = fixture({ dubs, alternate: dub, alternateResources: [progressive] });
    const result = await f.resolve("movie", "123", {});
    assert.equal(result.status, "ready"); assert.equal(result.source?.audios.length, 1);
  }
  const f = fixture({ dubs: [dub], alternate: { ...dub, year: 2021 }, alternateResources: [progressive] });
  assert.equal((await f.resolve("movie", "123", {})).source?.audios.length, 1);
});

test("TV dub needs its own exact requested episode proof; canonical proof cannot spill over", async () => {
  const dub = { ...subject, subjectId: "2", subjectType: 2, lang: "bn", label: "Bangla" };
  const f = fixture({ tv: true, episodes: [10], resources: [{ ...progressive, se: 1, ep: 10 }],
    dubs: [dub], alternate: { ...dub, seasons: [{ se: 1, maxEp: 99 }] }, alternateResources: [{ ...progressive, se: 1, ep: 2 }] });
  const result = await f.resolve("tv", "123", { season: 1, episode: 10 });
  assert.equal(result.status, "ready"); assert.equal(result.source?.audios.length, 1);
});

test("optional non-cooperative alternate detail cannot discard verified canonical playback", async () => {
  const dub = { ...subject, subjectId: "2", lang: "bn", label: "Bangla" };
  const f = fixture({ dubs: [dub], slowAlternate: true });
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready"); assert.equal(result.source?.audios.length, 1);
});

test("caption resource mismatch is omitted and effective deadline is common across all capabilities", async () => {
  const f = fixture({ resources: [progressive, { ...progressive, resourceId: "102", resolution: 360,
    resourceLink: "https://media.example.test/small.mp4", expiresAt: instant + 180000 }],
    captions: [{ resourceId: "999", url: "https://captions.example.test/wrong.srt", lan: "en", lanName: "Wrong" },
      { resourceId: "101", url: "https://captions.example.test/right.srt", lan: "bn", lanName: "Bangla", expiresAt: instant + 160000 }] });
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready");
  assert.equal(result.source?.subtitles.length, 1);
  assert.equal(result.source?.expiresAt, instant + 100000);
  for (const resource of [...result.source!.qualities, ...result.source!.subtitles]) {
    assert.equal(f.registry.expiresAt(resource.url.slice("/media/".length)), result.source!.expiresAt);
  }
});

test("four admission slots remain occupied by non-cooperative optional subwork", async () => {
  const second = { ...progressive, resourceId: "102", resolution: 360, resourceLink: "https://media.example.test/small.mp4" };
  let probes = 0;
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), now: () => instant });
  const metadata = new MovieBoxMetadata({ search: async () => ({ list: [subject] }), get: async (path) =>
    path.includes("/get?") ? subject : path.includes("/resource?") ? { resources: [progressive, second] } :
      path.includes("/play-info") ? { streams: [] } : { extCaptions: [] } });
  const transport: MediaTransport = { probe: async (resource) => { probes++; return resource.height === 720 ? true : new Promise<boolean>(() => undefined); },
    caption: async () => "WEBVTT\\n", relay: async () => new Response(null) };
  const resolve = createMovieBoxResolver({ registry, transport, metadata: () => metadata, now: () => instant,
    lookup: async () => ({ type: "movie", titles: [subject.title], year: 2020 }) });
  const ready = await Promise.all(["1", "2", "3", "4"].map((id) => resolve("movie", id, {})));
  assert.ok(ready.every((result) => result.status === "ready"));
  assert.equal((await resolve("movie", "5", {})).status, "unavailable");
  assert.equal(probes, 8);
});

test("failed discovery emits one fixed gate reason without changing status or bypassing guards", async () => {
  const cases: Array<{ options: Parameters<typeof fixture>[0]; status: string; stage: string; code: string }> = [
    { options: { noTarget: true }, status: "unverified", stage: "tmdb", code: "no_target" },
    { options: { searchRows: [{ ...subject, year: undefined }] }, status: "unverified", stage: "matching", code: "identity_incomplete" },
    { options: { searchRows: [subject, { ...subject, year: 2021 }] }, status: "unverified", stage: "matching", code: "identity_conflict" },
    { options: { searchRows: [] }, status: "not_found", stage: "matching", code: "not_found" },
    { options: { detailRow: {} }, status: "unverified", stage: "detail", code: "detail_missing" },
    { options: { detailRow: { ...subject, year: 2021 } }, status: "unverified", stage: "detail", code: "detail_mismatch" },
    { options: { tv: true, episodes: [], resources: [{ ...progressive, se: 1, ep: 2 }] }, status: "unverified", stage: "episode", code: "episode_evidence_missing" },
    { options: { resources: [{ ...progressive, signCookie: "private-policy-token" }], probe: false }, status: "unverified", stage: "media_probe", code: "probe_rejected" },
    { options: { resources: [{ ...progressive, codecName: undefined }] }, status: "unverified", stage: "stream", code: "codec_missing" },
    { options: { resources: [{ ...progressive, codecName: "HEVC" }], probe: false }, status: "unverified", stage: "media_probe", code: "probe_rejected" },
    { options: { resources: [{ ...progressive, resolution: undefined }] }, status: "unverified", stage: "stream", code: "height_missing" },
    { options: { resources: [{ ...progressive, format: "MKV" }] }, status: "unsupported_format", stage: "stream", code: "format" },
    { options: { resources: [], streams: [] }, status: "unsupported_format", stage: "stream", code: "no_candidates" },
    { options: { probe: false }, status: "unverified", stage: "media_probe", code: "probe_rejected" },
    { options: { probeError: new TransportError("blocked_address") }, status: "unavailable", stage: "media_probe", code: "blocked_address" },
    { options: { resourcesError: new Error("private-url https://secret.example/?token=private") }, status: "unavailable", stage: "resources", code: "unknown" },
  ];
  for (const row of cases) {
    const events: MovieBoxDiagnostic[] = [];
    const f = fixture({ ...row.options, diagnostic: (event) => { events.push(event); } });
    const result = await f.resolve(row.options?.tv ? "tv" : "movie", "123", { season: 1, episode: 10 });
    assert.deepEqual(result, { status: row.status });
    assert.deepEqual(events, [{ status: row.status, stage: row.stage, code: row.code }]);
    if (row.stage !== "media_probe") assert.equal(f.probes, 0);
    for (const privateValue of [subject.subjectId, "123", subject.title, "example", "private-policy-token", "token="]) {
      assert.equal(JSON.stringify(events).includes(privateValue), false);
    }
  }
});

test("duplicate uploads are verified in turn so a dead duplicate never blocks playback", async () => {
  // MovieBox lists the same film more than once under an identical title, type and year.
  // The leading duplicate here yields no playable media, so the next one must be tried.
  const duplicate = { ...subject, subjectId: "9000000000000000002", dubs: [] };
  const f = fixture({ searchRows: [subject, duplicate], alternate: duplicate,
    resources: [], alternateResources: [progressive] });
  const result = await f.resolve("movie", "123", {});
  assert.equal(result.status, "ready");
  assert.equal(result.source?.qualities.length, 1);
});

test("probe reason beats skipped metadata and adaptive classification keeps existing precedence", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const evidence = { playable: false, failure: { code: "invalid_response", httpStatus: 403,
    url: "https://private.example/?token=private", headers: { cookie: "private" }, etag: '"private"' } } as MediaProbeEvidence;
  const f = fixture({ resources: [{ ...progressive, codecName: undefined }, progressive], probeEvidence: evidence,
    diagnostic: (event) => { events.push(event); } });
  assert.deepEqual(await f.resolve("movie", "123", {}), { status: "unverified" });
  assert.deepEqual(events, [{ status: "unverified", stage: "media_probe", code: "invalid_response", httpStatus: 403 }]);
  const adaptive: MovieBoxDiagnostic[] = [];
  const g = fixture({ resources: [progressive, { ...progressive, resourceLink: "https://media.example.test/dash/index.mpd" }], probeEvidence: evidence,
    diagnostic: (event) => { adaptive.push(event); } });
  assert.deepEqual(await g.resolve("movie", "123", {}), { status: "unsupported_adaptive" });
  assert.deepEqual(adaptive, [{ status: "unsupported_adaptive", stage: "stream", code: "dash" }]);
});

test("unknown injected probe reasons cannot supply arbitrary codes or HTTP status", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const f = fixture({ probeEvidence: { playable: false, failure: { code: "private-url-token", httpStatus: 403 } } as unknown as MediaProbeEvidence,
    diagnostic: (event) => { events.push(event); } });
  assert.equal((await f.resolve("movie", "123", {})).status, "unverified");
  assert.deepEqual(events, [{ status: "unverified", stage: "media_probe", code: "probe_rejected" }]);
  const g = fixture({ probeEvidence: { playable: false, failure: { code: "timeout", httpStatus: 0 } },
    diagnostic: (event) => { events.push(event); } });
  assert.equal((await g.resolve("movie", "123", {})).status, "unverified");
  assert.deepEqual(events[1], { status: "unverified", stage: "media_probe", code: "timeout" });
});

test("authorization metadata does not block probing of otherwise valid streams", async () => {
  // Policy streams are probed with their auth headers; codec_missing on one
  // resource does not prevent the policy-authenticated resource from being probed.
  for (const resources of [[{ ...progressive, codecName: undefined }, { ...progressive, policy: { private: "private-policy" } }],
    [{ ...progressive, policy: { private: "private-policy" } }, { ...progressive, codecName: undefined }]]) {
    const events: MovieBoxDiagnostic[] = [];
    const f = fixture({ resources, diagnostic: (event) => { events.push(event); } });
    assert.equal((await f.resolve("movie", "123", {})).status, "ready");
    assert.equal(f.probes, 1);
    // codec_missing skips the first resource; the policy-authenticated resource is probed and ready.
    // No diagnostic is emitted when the overall result is "ready".
    assert.deepEqual(events, []);
  }
});

test("only known MovieBox codes and observed HTTP status survive unavailable errors", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const f = fixture({ resourcesError: new MovieBoxError("denied", 403), diagnostic: (event) => { events.push(event); } });
  assert.deepEqual(await f.resolve("movie", "123", {}), { status: "unavailable" });
  assert.deepEqual(events, [{ status: "unavailable", stage: "resources", code: "denied", httpStatus: 403 }]);
  const g = fixture({ resources: [], playInfoError: new MovieBoxError("timeout"), diagnostic: (event) => { events.push(event); } });
  assert.deepEqual(await g.resolve("movie", "123", {}), { status: "unsupported_format" });
  assert.deepEqual(events[1], { status: "unsupported_format", stage: "play_info", code: "timeout" });
});

test("default diagnostics are silent, canonical ready suppresses optional failures and callback throws are harmless", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const log = t.mock.method(console, "log", () => undefined);
  assert.equal((await fixture({ noTarget: true }).resolve("movie", "123", {})).status, "unverified");
  assert.equal(warn.mock.callCount(), 0); assert.equal(log.mock.callCount(), 0);
  const events: MovieBoxDiagnostic[] = [];
  const f = fixture({ captionsFail: true, playInfoFail: true, resources: [progressive, { ...progressive, signCookie: "private" }],
    diagnostic: (event) => { events.push(event); } });
  assert.equal((await f.resolve("movie", "123", {})).status, "ready"); assert.deepEqual(events, []);
  const g = fixture({ noTarget: true, diagnostic: () => { throw new Error("private-callback-error"); } });
  assert.equal((await g.resolve("movie", "123", {})).status, "unverified");
});

test("negative cache and shared singleflight emit once until the existing 15-second expiry", async () => {
  const events: MovieBoxDiagnostic[] = [];
  const f = fixture({ noTarget: true, diagnostic: (event) => { events.push(event); } });
  await Promise.all([f.resolve("movie", "123", {}), f.resolve("movie", "123", {})]);
  await f.resolve("movie", "123", {}); assert.equal(events.length, 1);
  f.tick(15001); await f.resolve("movie", "123", {}); assert.equal(events.length, 2);
});

test("runtime warning projects bounded fields and never interpolates unknown values", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  warnMovieBoxDiagnostic({ status: "unverified", stage: "media_probe", code: "invalid_response", httpStatus: 403,
    url: "https://private.example/?token=private", etag: '"private"', policy: "private" } as MovieBoxDiagnostic);
  assert.deepEqual(warn.mock.calls[0]?.arguments, ["[moviebox] discovery_failed status=unverified stage=media_probe code=invalid_response httpStatus=403"]);
  warnMovieBoxDiagnostic({ status: "unavailable", stage: "resources", code: "unknown", httpStatus: NaN });
  assert.deepEqual(warn.mock.calls[1]?.arguments, ["[moviebox] discovery_failed status=unavailable stage=resources code=unknown"]);
  warnMovieBoxDiagnostic({ status: "unverified", stage: "stream", code: "https://private.example/secret" } as unknown as MovieBoxDiagnostic);
  assert.equal(warn.mock.callCount(), 2);
});

test("concurrent identical lookups singleflight; aborted caller cannot mint stale playback", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.resolve("movie", "123", {}), f.resolve("movie", "123", {})]);
  assert.notEqual(a.source?.sessionId, b.source?.sessionId);
  assert.notEqual(a.source?.controlToken, b.source?.controlToken);
  assert.equal(f.probes, 1);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await f.resolve("movie", "456", {}, controller.signal)).status, "unavailable");
});
