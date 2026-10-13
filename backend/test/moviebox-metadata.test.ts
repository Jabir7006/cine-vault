import assert from "node:assert/strict";
import test from "node:test";
import { MovieBoxError } from "../src/moviebox/errors.js";
import { MovieBoxMetadata, classifyStream, parseCaptions, parseMovieBoxId, parsePlayInfo,
  parseResourcePage, parseSearchSubjects, parseSeasonInfo, parseSubjectDetail } from "../src/moviebox/metadata.js";

// Every fixture is synthetic; no operator key, network, real URL or reference execution.
const subject = { subjectId: "900719925474099312345", title: "Ｆilm 2", subjectType: 1, releaseDate: "2024-01-02" };
const cdn = "https://media.example.test/video.mp4";
const malformed = (error: unknown) => error instanceof MovieBoxError && error.code === "malformed";
const request = (error: unknown) => error instanceof MovieBoxError && error.code === "request";

test("positive decimal IDs preserve large strings and reject unsafe numeric precision", () => {
  for (const value of [1, Number.MAX_SAFE_INTEGER, "1", "900719925474099312345"]) assert.equal(parseMovieBoxId(value), String(value));
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", "01", "-1", "+1", " 1", "1 ", "1e3", "1.0", "١", "9".repeat(129), null, {}, true]) assert.equal(parseMovieBoxId(value), undefined);
});
test("search nested subjects/list and root list use strict identity aliases", () => {
  const results = parseSearchSubjects({ results: [{ subjects: [subject] }, { list: [{ id: 7, name: "Series", stype: "2", year: "2020" }] }] });
  assert.deepEqual(results, [{ subjectId: subject.subjectId, title: "Ｆilm 2", type: "movie", year: 2024 }, { subjectId: "7", title: "Series", type: "tv", year: 2020 }]);
  assert.equal(parseSearchSubjects({ list: [subject] }).length, 1);
  assert.deepEqual(parseSearchSubjects({ results: [] }), []);
  assert.deepEqual(parseSearchSubjects({ results: [{ subjects: [] }] }), []);
});
test("invalid IDs are dropped; missing/contradictory title/type/year never default", () => {
  const results = parseSearchSubjects({ list: [{ subjectId: 0 }, { subjectId: Number.MAX_SAFE_INTEGER + 1 }, { subjectId: "1" },
    { subjectId: "2", title: "Film", subjectType: 1, stype: 2, year: 2020, releaseDate: "2021-01-01" },
    { subjectId: "3", id: "4", title: "conflicting" }] });
  assert.equal(results.length, 2);
  assert.equal(results[0]!.title, undefined);
  assert.equal(results[0]!.type, undefined);
  assert.equal(results[0]!.year, undefined);
  assert.equal(results[1]!.type, undefined);
  assert.equal(results[1]!.year, undefined);
});
test("year evidence is leading explicit bounded year, not embedded digits or invalid aliases", () => {
  for (const releaseInfo of ["2024", "2024 · Fiction", "2024年", "2024 (fiction)"]) {
    assert.equal(parseSubjectDetail({ ...subject, releaseDate: undefined, releaseInfo })?.year, undefined); // Present invalid alias fails closed.
    const { releaseDate: _ignored, ...rest } = subject;
    assert.equal(parseSubjectDetail({ ...rest, releaseInfo })?.year, 2024);
  }
  for (const releaseInfo of ["Released in 2024", "20240", "0999", {}, "2024garbage"])
    assert.equal(parseSubjectDetail({ subjectId: "1", releaseInfo })?.year, undefined);
});
test("search containers and total count are bounded and malformed envelopes fail safely", () => {
  for (const value of [null, [], {}, { results: "bad" }, { results: [null] }, { list: {} }, { list: Array(501).fill(subject) },
    { results: [{ subjects: Array(300).fill(subject) }, { subjects: Array(201).fill(subject) }] }]) assert.throws(() => parseSearchSubjects(value), malformed);
});
test("detail accepts nested/root subject, preserves explicit alternate dubs privately", () => {
  const detail = parseSubjectDetail({ subject: { ...subject, seasons: [{ se: 3, episodeNumbers: [2, "8", 2], maxEp: 20 }] },
    dubs: [{ subjectId: "8", title: "Film 2", subjectType: 1, year: 2024, lang: "bn", label: "Bangla" }, { subjectId: "bad" }] });
  assert.equal(detail?.subjectId, subject.subjectId);
  assert.deepEqual(detail?.seasons, [{ se: 3, episodeNumbers: [2, 8], maxEp: 20 }]);
  assert.equal(detail?.dubs.length, 1);
  assert.equal(detail?.dubs[0]!.lang, "bn");
  assert.equal("ready" in detail!.dubs[0]!, false);
  assert.equal(parseSubjectDetail({ ...subject })?.year, 2024);
  assert.equal(parseSubjectDetail({ subject: { subjectId: "0" } }), undefined);
  assert.throws(() => parseSubjectDetail({ subject: [] }), malformed);
});
test("season numbers remain explicit; maxEp never expands into fabricated episodes", () => {
  assert.deepEqual(parseSeasonInfo({ seasons: [{ se: 1, maxEp: 15 }, { se: 4, episodeNumbers: [9, 13] }] }),
    [{ se: 1, episodeNumbers: [], maxEp: 15 }, { se: 4, episodeNumbers: [9, 13], maxEp: undefined }]);
  assert.equal(parseSeasonInfo({ subject: { seasons: [{ se: "2", episodeNumbers: ["7"] }] } })[0]!.se, 2);
  for (const value of [null, "bad", { subject: [] }, { seasons: [{ se: 0 }] }, { seasons: [{ se: 1, episodeNumbers: [0] }] },
    { seasons: [{ se: 1, episodeNumbers: "1,2" }] }, { seasons: [{ se: 1, maxEp: 10001 }] }, { seasons: Array(501).fill({ se: 1 }) }]) assert.throws(() => parseSeasonInfo(value), malformed);
});
test("play info retains actual bounded metadata only and never invents url or qualities", () => {
  const streams = parsePlayInfo({ streams: [{ id: "11", format: "MP4", codecName: "h264", resolutions: [480, "720"], size: 1000,
    signCookie: "opaque-not-a-destination" }] });
  assert.equal(streams[0]!.resourceId, "11");
  assert.equal(streams[0]!.url, undefined);
  assert.equal(streams[0]!.height, 720); // Derived from max resolutions when height/resolution absent.
  assert.equal(streams[0]!.codec, "h264");
  assert.deepEqual(streams[0]!.resolutions, [480, 720]);
  assert.equal(streams[0]!.requiresVerification, true);
  assert.deepEqual(classifyStream(streams[0]!), { status: "unverified", reason: "signed_policy" });
  // Comma-separated string resolutions are parsed into numeric arrays (API variant).
  const stringRes = parsePlayInfo({ streams: [{ url: cdn, codecName: "h264", resolutions: "1080,720,480" }] })[0]!;
  assert.deepEqual(stringRes.resolutions, [1080, 720, 480]);
  assert.deepEqual(parsePlayInfo({ streams: [] }), []);
});
test("resources preserve sparse explicit se/ep and resourceLink plus file fields", () => {
  const page = parseResourcePage({ list: [{ resourceId: "12", resourceLink: cdn, se: 7, ep: 13, resolution: "1080", codecName: "h265",
    fileName: "synthetic.mp4", title: "Synthetic", lanName: "Bangla", uploadBy: "fixture", source: "fixture", size: "55" }], hasMore: false }, 3, 2);
  assert.equal(page.page, 3);
  assert.equal(page.perPage, 2);
  assert.equal(page.hasMore, false);
  assert.equal(page.resources[0]!.url, cdn);
  assert.equal(page.resources[0]!.height, 1080);
  assert.equal(page.resources[0]!.se, 7);
  assert.equal(page.resources[0]!.ep, 13);
  assert.equal(page.resources[0]!.language, "Bangla");
  assert.equal(page.resources[0]!.size, 55);
  assert.equal(parseResourcePage({ list: [] }, 1, 10).hasMore, undefined);
});
test("invalid resource IDs, urls or partial/invalid episode pairs cannot supply evidence", () => {
  const resources = parsePlayInfo({ list: [{ id: "0", url: cdn }, { id: 2 ** 53, url: cdn }, { url: cdn, se: 1 }, { url: cdn, ep: 2 },
    { url: cdn, se: 1, ep: 0 }, { url: "javascript:alert(1)" }, { url: "https://user:password@media.example.test/file.mp4" },
    { url: "http://media.example.test/a.mp4" }, { url: `${cdn}#fragment` }] });
  assert.deepEqual(resources, []);
});
test("resource page/request limits are explicit and no inferred pagination", () => {
  assert.throws(() => parseResourcePage({ list: [ {}, {} ] }, 1, 1), malformed);
  assert.throws(() => parseResourcePage({ list: [], hasMore: "true" }, 1, 1), malformed);
  for (const [page, perPage] of [[0, 1], [101, 1], [1, 101], [1, 0], [1.5, 10]]) assert.throws(() => parseResourcePage({ list: [] }, page!, perPage!), request);
});
test("root authorization stays private and gates every child without decoding policy", () => {
  const opaque = "fixture/base64-not-decoded";
  const stream = parsePlayInfo({ signCookie: opaque, policy: "opaque-policy", headers: { "X-Fixture": "private" },
    streams: [{ url: cdn, headers: { "X-Child": "private" } }] })[0]!;
  assert.equal(stream.signCookie, opaque);
  assert.equal(stream.policy, "opaque-policy");
  assert.deepEqual(stream.headers, { "X-Fixture": "private", "X-Child": "private" });
  assert.equal(stream.url, cdn);
  assert.equal(stream.requiresVerification, true);
  const objectPolicy = parsePlayInfo({ policy: { opaque: true }, streams: [{ url: cdn }] })[0]!;
  assert.equal(objectPolicy.policy, undefined);
  assert.equal(classifyStream(objectPolicy).status, "unverified");
  const headerCookie = parsePlayInfo({ streams: [{ url: cdn, headers: { cOoKiE: "opaque" } }] })[0]!;
  assert.equal(headerCookie.requiresVerification, true);
  assert.equal(classifyStream(headerCookie).status, "unverified");
});
test("private headers are bounded and injection is rejected without raw leakage", () => {
  for (const headers of [{ Cookie: "bad\r\nInjected: 1" }, { "bad key": "private" }, { token: 5 }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`X-${i}`, "v"]))]) {
    assert.throws(() => parsePlayInfo({ streams: [{ url: cdn, headers }] }), (error: unknown) => malformed(error) && !String(error).includes("Injected"));
  }
});
test("captions adapt extCaptions lan/lanName and retain no public ready claim", () => {
  const captions = parseCaptions({ extCaptions: [{ id: "9", resourceId: 10, url: "https://captions.example.test/fixture.srt", lan: "bn", lanName: "Bangla", format: "srt" },
    { url: "file:///tmp/fixture" }, { id: "0", url: cdn }] });
  assert.equal(captions.length, 1);
  assert.equal(captions[0]!.lang, "bn");
  assert.equal(captions[0]!.label, "Bangla");
  assert.equal(captions[0]!.resourceId, "10");
  assert.equal("ready" in captions[0]!, false);
  const signed = parseCaptions({ policy: "opaque", extCaptions: [{ url: cdn }] })[0]!;
  assert.equal(signed.requiresVerification, true);
  assert.equal(signed.policy, "opaque");
});
test("adaptive URL markers override misleading MP4 metadata and signed policy", () => {
  for (const [path, reason] of [["/dash/video.mp4", "dash"], ["/hls/video.mp4", "hls"], ["/video.MPD", "dash"], ["/video.m3u8", "hls"], ["/%64ash/video.mp4", "dash"]]) {
    assert.deepEqual(classifyStream({ url: `https://media.example.test${path}?signature=fixture`, format: "MP4", requiresVerification: true }), { status: "unsupported_adaptive", reason });
  }
});
test("notice/deprecation paths are rejected; extension/MP4 labels alone are never progressive", () => {
  for (const path of ["/notice.mp4", "/deprecated/file.mp4", "/deprecation_notice.mp4"]) assert.deepEqual(classifyStream({ url: `https://media.example.test${path}`, format: "MP4", requiresVerification: true }), { status: "unsupported_format", reason: "notice" });
  for (const url of [cdn, "https://media.example.test/opaque", "https://media.example.test/unnoticed.mp4"]) assert.deepEqual(classifyStream({ url, format: "MP4", requiresVerification: false }), { status: "unverified", reason: "media_evidence_required" });
  assert.deepEqual(classifyStream({ url: cdn, policy: "not-decoded", requiresVerification: false }), { status: "unverified", reason: "signed_policy" });
  assert.deepEqual(classifyStream({ format: "MP4", requiresVerification: false }), { status: "unsupported_format", reason: "missing_url" });
  assert.deepEqual(classifyStream({ url: "http://example.test/x.mp4", requiresVerification: false }), { status: "unsupported_format", reason: "invalid_url" });
  assert.deepEqual(classifyStream({ url: cdn, format: "MKV", requiresVerification: false }), { status: "unsupported_format", reason: "format" });
});
test("unknown values and numeric media metadata stay bounded without unsafe coercion", () => {
  const parsed = parsePlayInfo({ streams: [{ url: cdn, height: 9000, size: 2 ** 53, quality: "x".repeat(65), codec: "x".repeat(129) }] })[0]!;
  assert.equal(parsed.height, undefined);
  assert.equal(parsed.size, undefined);
  assert.equal(parsed.expiresAt, undefined);
  assert.equal(parsed.quality, undefined);
  assert.equal(parsed.codec, undefined);
  for (const value of [null, "bad", {}, { streams: {} }, { streams: Array(501).fill({ url: cdn }) },
    { streams: [{ url: cdn, resolutions: [0] }] }, { streams: [{ url: cdn, resolutions: Array(33).fill(1080) }] }])
    assert.throws(() => parsePlayInfo(value), malformed);
  assert.deepEqual(parsePlayInfo({ streams: [{ url: `https://media.example.test/${"x".repeat(8192)}` }] }), []);
});
test("narrow injected adapter paths, string precision, TV exact pairs and single-page resources", async () => {
  const calls: string[] = [];
  const searches: [string, number | undefined][] = [];
  const metadata = new MovieBoxMetadata({ get: async (path) => {
    calls.push(path);
    if (path.includes("/get?")) return { subject };
    if (path.includes("season-info")) return { seasons: [] };
    if (path.includes("get-ext-captions")) return { extCaptions: [] };
    if (path.includes("/resource?")) return { list: [] };
    return { streams: [] };
  }, search: async (keyword, page) => { searches.push([keyword, page]); return { list: [subject] }; } });
  await metadata.search("Film 2");
  await metadata.detail(subject.subjectId);
  await metadata.seasons(7);
  await metadata.playInfo(7);
  await metadata.playInfo(7, { season: 3, episode: 13 });
  await metadata.resources(7, { page: 2, perPage: 15, selection: { season: 3, episode: 13 } });
  await metadata.captions(7, subject.subjectId);
  assert.deepEqual(searches, [["Film 2", 1]]);
  assert.deepEqual(calls, [
    `/wefeed-mobile-bff/subject-api/get?subjectId=${subject.subjectId}`,
    "/wefeed-mobile-bff/subject-api/season-info?subjectId=7",
    "/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=7",
    "/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=7&se=3&ep=13",
    "/wefeed-mobile-bff/subject-api/resource?subjectId=7&se=3&ep=13&page=2&perPage=15",
    `/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=7&resourceId=${subject.subjectId}`,
  ]);
});
test("explicit malformed stream/caption expiry is dropped rather than treated as absent", () => {
  for (const expiresAt of [null, undefined, -1, 0, NaN, Infinity, "bad", "1e3", 2 ** 53]) {
    assert.deepEqual(parsePlayInfo({ streams: [{ url: cdn, expiresAt }] }), []);
    assert.deepEqual(parseCaptions({ extCaptions: [{ url: cdn, expiresAt }] }), []);
  }
  assert.equal(parsePlayInfo({ streams: [{ url: cdn }] }).length, 1);
  assert.equal(parseCaptions({ extCaptions: [{ url: cdn, expiresAt: 1800000000000 }] })[0]!.expiresAt, 1800000000000);
});

test("invalid request values reject before transport and injected errors propagate safely", async () => {
  let calls = 0;
  const metadata = new MovieBoxMetadata({ get: async () => { calls++; return {}; }, search: async () => { calls++; return {}; } });
  for (const promise of [metadata.detail(2 ** 53), metadata.detail("1&se=2"), metadata.seasons(0), metadata.playInfo(1, { season: 0, episode: 1 }),
    metadata.resources(1, { page: 101, perPage: 15 }), metadata.captions(1, "0"), metadata.search(""), metadata.search("x", 0)]) await assert.rejects(promise, request);
  assert.equal(calls, 0);
  const timeout = new MovieBoxError("timeout");
  const failing = new MovieBoxMetadata({ get: async () => { throw timeout; }, search: async () => { throw timeout; } });
  await assert.rejects(failing.detail(1), (error) => error === timeout);
});
