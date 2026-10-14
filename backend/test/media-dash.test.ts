import assert from "node:assert/strict";
import test from "node:test";
import { authorizedDashManifest, dashAudioRepresentationId, dashManifestHeights, dashSegmentUrl, isDashSegmentName,
  nextDashSegmentNames, rewriteDashManifest } from "../src/media/dash.ts";

// Every fixture is synthetic; the encodings mirror the two carriers the live API uses.
const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
const prefix = (url: string) => `Edge-Cache-Cookie=urlprefix=${encode(url).replace(/\+/g, "-").replace(/\//g, "_")}:sign=fixture:t=1700000000`;
const policy = (resource: string) => `CloudFront-Policy=${Buffer.from(JSON.stringify({ Statement: [{ Resource: resource }] }), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/\//g, "~")}`;
const cdn = "https://sbcdn3.example.test/dash/1234_0_0_1080_h265_559";
const manifest = `${cdn}/index.mpd`;
const digest = "fixture/base64-not-decoded";

test("both authorization carriers name the manifest and nothing is guessed", () => {
  assert.equal(authorizedDashManifest(prefix(`${cdn}/`)), manifest);
  assert.equal(authorizedDashManifest(policy(`${cdn}/*`)), manifest);
  assert.equal(authorizedDashManifest(policy(cdn)), manifest);
  // Semicolon-separated carriers are scanned in order; a leading unusable entry is not fatal.
  assert.equal(authorizedDashManifest(`a=b; ${prefix(cdn)}`), manifest);
  assert.equal(authorizedDashManifest(`Edge-Cache-Cookie=urlprefix=${encode(`${cdn}/`)}:sign=x`), manifest);
  // Surrounding whitespace is meaningless in a header value and is ignored; interior whitespace is refused.
  assert.equal(authorizedDashManifest(prefix(`  ${cdn}/  `)), manifest);
});

test("an unusable authorization yields no destination instead of throwing", () => {
  const values: (string | undefined)[] = [
    undefined, "", "sign=fixture", "urlprefix=", "urlprefix=:sign=x", "CloudFront-Policy=", "CloudFront-Policy=!!!",
    // A prefix outside the CDN's dash tree, an insecure scheme, interior whitespace or an escape, a truncated token.
    prefix("https://sbcdn3.example.test/vod/1234/"), prefix("http://sbcdn3.example.test/dash/1/"),
    prefix("https://sbcdn3.example.test/dash/1\n/x"), prefix("https://sbcdn3.example.test/dash/1 \\x"),
    "urlprefix=" + "A".repeat(9000), digest,
    // Policy documents that decode but do not name a resource.
    `CloudFront-Policy=${encode("not json")}`, `CloudFront-Policy=${encode("{}")}`,
    `CloudFront-Policy=${encode(JSON.stringify({ Statement: [] }))}`,
    `CloudFront-Policy=${encode(JSON.stringify({ Statement: [{ Resource: 5 }] }))}`,
    `CloudFront-Policy=${encode(JSON.stringify({ Statement: [{ Resource: "https://sbcdn3.example.test/vod/x/*" }] }))}`,
  ];
  for (const value of values) assert.equal(authorizedDashManifest(value), undefined, String(value).slice(0, 40));
});

test("segment names are flat media file names only", () => {
  for (const name of ["init-stream0.m4s", "chunk-stream0-00001.m4s", "0.mp4", "seg_1.cmfv", "A-1_2.m4s"]) {
    assert.equal(isDashSegmentName(name), true, name);
  }
  for (const name of ["", ".", "..", "index.mpd", "../x.m4s", "a/b.m4s", "a\\b.m4s", "/etc/passwd", "x.m4s/",
    "a..m4s", ".hidden.m4s", "x.m4s?q=1", "x.m4s#f", "x.txt", "x.m4ss", "x\nm4s", "A-1_2.M4S",
    "a".repeat(140) + ".m4s", "café.m4s"]) {
    assert.equal(isDashSegmentName(name), false, name);
  }
});

test("segments resolve inside the manifest's own directory", () => {
  assert.equal(dashSegmentUrl(manifest, "init-stream0.m4s"), `${cdn}/init-stream0.m4s`);
  assert.equal(dashSegmentUrl(manifest, "chunk-stream3-00142.m4s"), `${cdn}/chunk-stream3-00142.m4s`);
  assert.equal(dashSegmentUrl(manifest, "../x.m4s"), undefined);
  assert.equal(dashSegmentUrl(manifest, "x.txt"), undefined);
  assert.equal(dashSegmentUrl("https://sbcdn3.example.test/index.mpd", "init.m4s"), undefined);
});

test("absolute references are rewritten to the relay while relative templates stay relative", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:mpeg:DASH:schema:MPD:2011 https://standards.iso.org/xsd/DASH-MPD.xsd">
  <Period>
    <AdaptationSet contentType="video" maxHeight="1080">
      <Representation id="0" height="1080" codecs="hev1">
        <BaseURL>${cdn}/1080.mp4</BaseURL>
        <SegmentTemplate initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" />
      </Representation>
      <Representation id="3">
        <SegmentTemplate initialization="${cdn}/audio/init-stream3.m4s" media="${cdn}/audio/chunk-stream3-$Number%05d$.m4s" />
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="video" maxHeight="480">
      <Representation id="2" height="480" codecs="hev1" />
    </AdaptationSet>
  </Period>
</MPD>`;
  const rewritten = rewriteDashManifest(xml, manifest, "/media/TOKEN/");
  assert.ok(rewritten.includes("/media/TOKEN/1080.mp4"), "absolute BaseURL is relayed");
  assert.ok(rewritten.includes("/media/TOKEN/audio/init-stream3.m4s"), "absolute initialization is relayed");
  assert.ok(rewritten.includes("/media/TOKEN/audio/chunk-stream3-$Number%05d$.m4s"), "absolute media template is relayed");
  assert.ok(rewritten.includes(`media="chunk-stream$RepresentationID$-$Number%05d$.m4s"`), "relative media template stays relative");
  assert.ok(rewritten.includes("https://standards.iso.org/xsd/DASH-MPD.xsd"), "schema locations are untouched");
  assert.ok(rewritten.includes("urn:mpeg:DASH:schema:MPD:2011"), "namespaces are untouched");
  assert.equal(rewritten.includes(cdn), false, "the upstream directory never leaks");
  // An unrelated manifest has nothing to rewrite and is returned byte-for-byte.
  const foreign = "<MPD><Period><AdaptationSet><Representation id=\"0\" /></AdaptationSet></Period></MPD>";
  assert.equal(rewriteDashManifest(foreign, manifest, "/media/TOKEN/"), foreign);
  // The authorization is the only source of the directory, so a foreign manifest cannot be redirected.
  assert.equal(rewriteDashManifest(`${cdn}/x`, "https://other.example.test/dash/1/index.mpd", "/m/"), `${cdn}/x`);
});

test("heights come from video representations, bounded and deduplicated", () => {
  assert.deepEqual(dashManifestHeights(`<MPD><AdaptationSet maxHeight="1080" contentType="video">
    <Representation id="0" height="1080" /><Representation id="1" height="720" />
    <Representation id="2" height="480" /><Representation id="3" height="720" /></AdaptationSet>
    <AdaptationSet contentType="audio"><Representation id="4" bandwidth="128000" /></AdaptationSet></MPD>`), [1080, 720, 480]);
  assert.deepEqual(dashManifestHeights("<MPD />"), []);
  // Out-of-range and non-numeric heights are not evidence of a video representation.
  assert.deepEqual(dashManifestHeights(`<Representation height="0" /><Representation height="99999" /><Representation height="abc" /><Representation height="12"/>`), []);
  assert.equal(dashManifestHeights(Array.from({ length: 200 }, (_value, index) => `<Representation height="${144 + index * 4}" />`).join("")).length, 64);
});

// The audio representation id is read from the manifest's own adaptation sets.
const withAudio = (id: string) => `<MPD><Period>
  <AdaptationSet id="0" contentType="video"><Representation id="0" height="1080"><SegmentTemplate media="chunk-stream0-$Number%05d$.m4s" /></Representation></AdaptationSet>
  <AdaptationSet id="3" contentType="audio" lang="en"><Representation id="${id}" bandwidth="128000"><SegmentTemplate media="chunk-stream${id}-$Number%05d$.m4s" /></Representation></AdaptationSet>
</Period></MPD>`;

test("the audio representation is taken from the manifest", () => {
  assert.equal(dashAudioRepresentationId(withAudio("3")), "3");
  assert.equal(dashAudioRepresentationId(withAudio("7")), "7");
  assert.equal(dashAudioRepresentationId("<MPD><AdaptationSet contentType=\"video\"><Representation id=\"0\" /></AdaptationSet></MPD>"), undefined);
  // A description that names no representation, or one with an implausible id, is not usable evidence.
  assert.equal(dashAudioRepresentationId("<MPD><AdaptationSet contentType=\"audio\"></AdaptationSet></MPD>"), undefined);
  assert.equal(dashAudioRepresentationId("<MPD><AdaptationSet contentType=\"audio\"><Representation id=\"a b/c\" /></AdaptationSet></MPD>"), undefined);
  // Video-first wording inside an audio set never redirects the prefetch.
  assert.equal(dashAudioRepresentationId("<MPD><AdaptationSet contentType=\"video\"><Representation id=\"0\" /></AdaptationSet></MPD>"), undefined);
});

test("lookahead names the following segments and the audio sibling", () => {
  assert.deepEqual(nextDashSegmentNames("chunk-stream0-00007.m4s", 2, "3"), [
    "chunk-stream0-00008.m4s", "chunk-stream0-00009.m4s", "chunk-stream3-00007.m4s", "chunk-stream3-00008.m4s",
  ]);
  // Padding width is the segment's own, and an unknown audio representation adds nothing.
  assert.deepEqual(nextDashSegmentNames("chunk-stream0-7.m4s", 1), ["chunk-stream0-8.m4s"]);
  assert.deepEqual(nextDashSegmentNames("chunk-stream3-00007.m4s", 1, "3"), ["chunk-stream3-00008.m4s"]);
  // Initialization segments and anything that is not a numbered chunk have no successors to name.
  for (const name of ["init-stream0.m4s", "chunk-stream0.m4s", "chunk-stream0-00007.mp4.bak", "index.mpd", "chunk-stream0-00007.m4s.bak", "../chunk-stream0-00007.m4s"]) {
    assert.deepEqual(nextDashSegmentNames(name, 3, "3"), [], name);
  }
  for (const count of [0, 9, -1, 1.5]) assert.deepEqual(nextDashSegmentNames("chunk-stream0-00007.m4s", count, "3"), [], String(count));
});
