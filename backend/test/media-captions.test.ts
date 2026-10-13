import assert from "node:assert/strict";
import test from "node:test";
import { CaptionError, convertCaptionToWebVtt, MAX_CAPTION_BYTES } from "../src/media/captions.js";
import type { CaptionFormat } from "../src/media/captions.js";

const SRT_TIME = "00:00:01,000 --> 00:00:02,500";
const VTT_TIME = "00:00:01.000 --> 00:00:02.500";
function srt(text = "Synthetic caption", time = SRT_TIME) { return `1\n${time}\n${text}\n`; }
function vtt(text = "Synthetic caption", time = VTT_TIME) { return `WEBVTT\n\n${time}\n${text}\n`; }
function rejects(input: string | Uint8Array, format: CaptionFormat) {
  assert.throws(() => convertCaptionToWebVtt(input, format),
    (error: unknown) => error instanceof CaptionError && error.message === "Invalid or unsupported caption");
}

test("SRT converts only parsed cues, supporting BOM, CRLF, Unicode and multiline text", () => {
  const input = `﻿1\r\n${SRT_TIME}\r\n<b>Hello</b>\r\nবাংলা 世界\r\n\r\n2\r\n01:02:03,004 --> 01:02:03,004\r\nEqual times\r\n`;
  assert.equal(convertCaptionToWebVtt(input, "srt"),
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello বাংলা 世界\n\n01:02:03.004 --> 01:02:03.004\nEqual times\n");
  assert.equal(convertCaptionToWebVtt(Buffer.from(input, "utf8"), "srt"), convertCaptionToWebVtt(input, "srt"));
});

test("WebVTT parses optional identifiers, short timestamps and validated settings without copying them", () => {
  const input = "﻿WEBVTT synthetic fixture\r\n\r\ncue-id\r\n00:01.000 --> 00:02.500 line:90% position:50%,center size:80% align:center\r\n<v Voice><i>Hello</i></v>\r\n";
  assert.equal(convertCaptionToWebVtt(input, "vtt"), "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\n");
  assert.equal(convertCaptionToWebVtt(vtt("long", "123:00:01.000 --> 123:00:02.000"), "vtt"),
    "WEBVTT\n\n123:00:01.000 --> 123:00:02.000\nlong\n");
  assert.equal(convertCaptionToWebVtt("WEBVTT", "vtt"), "WEBVTT\n\n");
});

test("NOTE STYLE REGION metadata and cue identifiers are not emitted or turned into cues", () => {
  const input = `WEBVTT\n\nNOTE synthetic note\n<script>unsafe()</script>\n00:00:01.000 --> 00:00:02.000\n\nSTYLE\n::cue { background: url(https://untrusted.example.test/); }\n\nREGION\nid:fixture\nwidth:50%\n\n<script>identifier()</script>\n${VTT_TIME}\nactual caption\n`;
  assert.equal(convertCaptionToWebVtt(input, "vtt"), "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nactual caption\n");
  assert.equal(convertCaptionToWebVtt("WEBVTT\n\nNOTE only metadata\nignored\n", "vtt"), "WEBVTT\n\n");
});

test("all cue markup, scripts/styles, timestamp tags and control characters are stripped", () => {
  const text = '<b>visible</b> <script>alert(1)</script> <style>bad</style> <c.red>safe</c> <00:00:01.000> &#x3c;img src=x onerror=bad&#x3e; &lt;script&gt;bad&lt;/script&gt;\u0000\u0085‮ end';
  const output = convertCaptionToWebVtt(srt(text), "srt");
  assert.equal(output, `WEBVTT\n\n${VTT_TIME}\nvisible safe end\n`);
  assert.ok(!/[<>\p{Cc}\p{Cf}]/u.test(output.split("\n")[3]!));
  assert.equal(convertCaptionToWebVtt(srt("A &amp; B &lt;b&gt;bold&lt;/b&gt;"), "srt"),
    `WEBVTT\n\n${VTT_TIME}\nA &amp; B bold\n`);
  assert.equal(convertCaptionToWebVtt(srt("visible <script>unterminated executable text"), "srt"),
    `WEBVTT\n\n${VTT_TIME}\nvisible\n`);
  assert.equal(convertCaptionToWebVtt(srt("visible " + "<".repeat(400_000)), "srt"),
    `WEBVTT\n\n${VTT_TIME}\nvisible\n`);
});

test("cue payload cannot inject blocks or timelines with arrows, entities or Unicode newlines", () => {
  const malicious = "safe\n00:00:05.000 --> 00:00:06.000\nSTYLE\n::cue { color: red; }  NOTE &#10; injected &#45;&#45;&#62; &#x0d;&#x0a; done";
  for (const [input, format] of [[srt(malicious), "srt"], [vtt(malicious), "vtt"]] as const) {
    const output = convertCaptionToWebVtt(input, format);
    assert.equal((output.match(/-->/g) ?? []).length, 1);
    assert.equal(output.split("\n").filter(Boolean).length, 3);
    assert.ok(!output.includes("\nSTYLE"));
    assert.ok(!output.includes("\nNOTE"));
    assert.ok(!output.includes(" "));
    assert.ok(!output.includes(" "));
  }
});

test("invalid timestamps, ordering and cue syntax fail closed rather than inventing cues", () => {
  for (const time of ["00:60:01,000 --> 00:00:02,500", "00:00:60,000 --> 00:01:02,500",
    "0:00:01,000 --> 00:00:02,500", "-01:00:01,000 --> 00:00:02,500", "00:00:01,00 --> 00:00:02,500",
    "00:00:01.000 --> 00:00:02.500", "00:00:03,000 --> 00:00:02,500", "NaN --> Infinity",
    "00:00:01,000-->00:00:02,500", `${SRT_TIME} align:center`, `${SRT_TIME} --> 00:00:04,000`]) {
    rejects(srt("text", time), "srt");
  }
  for (const time of ["00:60.000 --> 01:00.000", "60:00.000 --> 61:00.000", "00:00:01,000 --> 00:00:02,000",
    "00:00:03.000 --> 00:00:02.000", `${VTT_TIME} invalid:setting`, `${VTT_TIME} size:101%`,
    `${VTT_TIME} align:center align:end`, `${VTT_TIME} line:50%,bogus`, `${VTT_TIME} position:50%,center,extra`,
    `${VTT_TIME} size:NaN%`, `${VTT_TIME} script:bad`]) {
    rejects(vtt("text", time), "vtt");
  }
  for (const input of ["", "unparsed text", `${SRT_TIME}\ntext`, `one\n${SRT_TIME}\ntext`,
    `1\n${SRT_TIME}`, srt("<script>gone</script>"), `${srt()}\n2\ninvalid\ntext`]) rejects(input, "srt");
  for (const input of ["", "not WebVTT", `${VTT_TIME}\ntext`, `WEBVTT\n${VTT_TIME}\ntext`,
    `WEBVTT --> invalid\n\n${VTT_TIME}\ntext`, "WEBVTT\n\nidentifier\nnot-a-timeline\ntext",
    `WEBVTT\n\n${VTT_TIME}`, vtt("<b></b>"), vtt("text", `${VTT_TIME} bogus`)]) rejects(input, "vtt");
});

test("non-UTF8, unpaired surrogates and oversized byte input fail with generic errors", () => {
  rejects(Buffer.from([0xff, 0xfe, 0x61]), "srt");
  rejects(Buffer.concat([Buffer.from(srt()), Buffer.from([0xc3, 0x28])]), "srt");
  rejects(srt("broken \ud800"), "srt");
  rejects(new Uint8Array(MAX_CAPTION_BYTES + 1), "vtt");
  rejects(srt("a".repeat(MAX_CAPTION_BYTES)), "srt");
  rejects(srt("雪".repeat(Math.floor(MAX_CAPTION_BYTES / 3))), "srt");
  rejects(srt("&".repeat(MAX_CAPTION_BYTES / 4)), "srt"); // Output expansion also bounded.
  const prefix = `1\n${SRT_TIME}\n`;
  const atLimit = prefix + "a".repeat(MAX_CAPTION_BYTES - Buffer.byteLength(prefix));
  // A maximum-sized input may exceed the output limit after WEBVTT is added.
  rejects(atLimit, "srt");
  const below = srt("a".repeat(MAX_CAPTION_BYTES - 100));
  assert.ok(Buffer.byteLength(convertCaptionToWebVtt(below, "srt")) <= MAX_CAPTION_BYTES);
});

test("ASS SSA SUB and mismatched formats never produce invented captions", () => {
  for (const format of ["ass", "ssa", "sub", "SRT", "", undefined] as unknown[]) {
    rejects(srt(), format as CaptionFormat);
  }
  for (const input of ["[Script Info]\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,fixture",
    "{25}{50}MicroDVD fixture", "[00:00:01]SUB fixture"]) {
    rejects(input, "srt");
    rejects(input, "vtt");
  }
  rejects(vtt(), "srt");
  rejects(srt(), "vtt");
});
